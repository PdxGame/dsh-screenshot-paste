// dsh-screenshot-paste — host half (runs in the dsh host process).
// Screenshot paste board API under /api/screenshot-paste/*:
//   POST   /api/screenshot-paste/save?mime=...   body: { data: <base64> }  -> save image
//   GET    /api/screenshot-paste/list            -> { dir, files: [...] }
//   GET    /api/screenshot-paste/file?name=...   -> image bytes (thumbnails)
//   DELETE /api/screenshot-paste/delete?name=... -> remove one file
//   DELETE /api/screenshot-paste/clear           -> remove all files
// All routes are loopback-only, mirroring the platform's own API hygiene.
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { homedir } from "node:os"

// Save directory resolution (portable across machines), in priority order:
//   1. settings namespace value (dsh-screenshot-paste.dir, live/hot-applied)
//   2. DSH_SCREENSHOT_DIR env var (explicit override, also used by tests)
//   3. F:\dsh-screenshots (the classic default)
//   4. ~/.dsh/screenshots — automatic fallback when the F: drive does not
//      exist (other PCs), so the plugin works out of the box anywhere.
let SCREENSHOT_DIR = ""

function resolveScreenshotDir(override = "") {
  const candidates = [
    override,
    process.env.DSH_SCREENSHOT_DIR ?? "",
    "F:\\dsh-screenshots",
    join(homedir(), ".dsh", "screenshots"),
  ]
  for (const candidate of candidates) {
    if (candidate === "") continue
    try {
      mkdirSync(candidate, { recursive: true })
      return candidate
    } catch {
      // try the next candidate
    }
  }
  return join(homedir(), ".dsh", "screenshots")
}

/**
 * Load the official settings packages (dynamic, so link-based dev installs
 * — where these modules cannot resolve — degrade gracefully instead of
 * crashing the server). Returns false when unavailable.
 */
let settingsLibs = null
async function loadSettingsLibs() {
  if (settingsLibs === null) {
    try {
      const [settings, schemasteryMod] = await Promise.all([
        import("@deepseek-ai/dsh-settings"),
        import("@deepseek-ai/schemastery"),
      ])
      // The official fork (like upstream schemastery 3.x) is a CJS build whose
      // default export is the Schema function itself; Schema.object() etc. are
      // static methods on it. Normalize that here so callers can use
      // `schemastery.Schema` regardless of interop shape.
      settingsLibs = { settings, schemastery: schemasteryMod.default || schemasteryMod }
    } catch {
      settingsLibs = false
    }
  }
  return settingsLibs
}
const API_PREFIX = "/api/screenshot-paste"
const MAX_FILE_BYTES = 50 * 1024 * 1024
// Images, documents, archives, audio/video, text formats — everything the
// paste board accepts. Anything else is rejected with a clear error instead
// of being mislabeled.
const ALLOWED_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".log",
  ".html", ".htm", ".xml",
  ".zip", ".7z", ".rar", ".tar", ".gz",
  ".mp3", ".wav", ".m4a", ".ogg",
  ".mp4", ".mov", ".webm",
])

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xml": "text/xml; charset=utf-8",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
}

const EXT_BY_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/x-7z-compressed": ".7z",
  "application/vnd.rar": ".rar",
  "application/x-tar": ".tar",
  "application/gzip": ".gz",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "application/json": ".json",
  "text/yaml": ".yaml",
  "text/xml": ".xml",
  "text/html": ".html",
}

/**
 * Pending screenshot references per session (in-memory). The web client
 * keeps its chips purely in this store — the input draft stays completely
 * untouched (no placeholders) — and an agent/pre-step listener appends the
 * paths to the next user message before the model request, then clears it.
 */
const pendingBySession = new Map()

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? ""
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1"
}

/**
 * Cross-site request fence for state-changing routes. The API is
 * loopback-only, but a malicious web page can still fire "simple requests"
 * (POST with text/plain, no preflight) at it. Accept requests without an
 * Origin header (curl, tests, non-browser clients) or whose Origin is
 * itself loopback; reject every remote page.
 */
function isTrustedOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const host = new URL(origin).hostname
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]"
  } catch {
    return false
  }
}

function writeJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(payload))
}

function readJsonBody(req) {
  return new Promise((resolvePromise) => {
    const chunks = []
    let size = 0
    req.on("data", (chunk) => {
      size += chunk.length
      if (size > MAX_FILE_BYTES + 1024 * 1024) {
        req.destroy()
        resolvePromise(undefined)
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        resolvePromise(undefined)
      }
    })
    req.on("error", () => resolvePromise(undefined))
  })
}

/** Only allow plain file names inside SCREENSHOT_DIR (no traversal). */
function safeName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 120) return undefined
  // Only alphanumeric / CJK / dot / underscore / hyphen, and never a leading
  // dot: separators and ".." are rejected here, which is what keeps every
  // resolved path inside SCREENSHOT_DIR.
  if (!/^[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff._-]*$/.test(name)) return undefined
  return name
}

function listFiles() {
  let entries = []
  try {
    entries = readdirSync(SCREENSHOT_DIR)
  } catch {
    return []
  }
  const files = []
  for (const name of entries) {
    const ext = extname(name).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) continue
    try {
      const st = statSync(join(SCREENSHOT_DIR, name))
      if (!st.isFile()) continue
      files.push({
        name,
        path: join(SCREENSHOT_DIR, name),
        size: st.size,
        mtime: st.mtimeMs,
        url: `${API_PREFIX}/file?name=${encodeURIComponent(name)}`,
      })
    } catch {
      // skip unreadable entries
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  return files
}

function extForMime(mime) {
  return EXT_BY_MIME[String(mime ?? "").toLowerCase()] ?? undefined
}

function mimeForExt(ext) {
  return MIME_BY_EXT[ext] ?? "application/octet-stream"
}

function isImageExt(ext) {
  return ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp" || ext === ".gif" || ext === ".bmp"
}

function queryParam(url, name) {
  return url.searchParams.get(name) ?? undefined
}

export const name = "dsh-screenshot-paste"

export const inject = ["webServer"]

export async function apply(ctx) {
  SCREENSHOT_DIR = resolveScreenshotDir()

  const routes = [
    {
      kind: "exact",
      path: `${API_PREFIX}/save`,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return void writeJson(res, 403, { error: "forbidden: loopback-only" })
        if (!isTrustedOrigin(req)) return void writeJson(res, 403, { error: "forbidden: cross-site request" })
        if (req.method !== "POST") return void writeJson(res, 405, { error: `method not allowed: ${req.method}` })
        const body = await readJsonBody(req)
        if (body === undefined || typeof body.data !== "string" || body.data.length === 0) {
          return void writeJson(res, 400, { error: "missing base64 data" })
        }
        let buffer
        try {
          buffer = Buffer.from(body.data, "base64")
        } catch {
          return void writeJson(res, 400, { error: "invalid base64 data" })
        }
        if (buffer.length === 0) return void writeJson(res, 400, { error: "empty file" })
        if (buffer.length > MAX_FILE_BYTES) return void writeJson(res, 413, { error: "file too large" })
        // Extension: prefer the original file name, fall back to the MIME map.
        const originalName = typeof body.name === "string" ? body.name : ""
        const nameExt = extname(originalName).toLowerCase()
        const ext = ALLOWED_EXT.has(nameExt) ? nameExt : extForMime(body.mime)
        if (ext === undefined) {
          return void writeJson(res, 400, { error: `unsupported file type${nameExt !== "" ? `: ${nameExt}` : ""}` })
        }
        // Stem: keep the original base name for files, "shot" for screenshots.
        const rawStem = originalName.replace(/\.[^.]+$/, "")
        const stem = rawStem.replace(/[^A-Za-z0-9\u4e00-\u9fff._-]/g, "").slice(0, 40) || (isImageExt(ext) ? "shot" : "file")
        const stamp = new Date()
        const pad = (n) => String(n).padStart(2, "0")
        // Human-readable names: <stem>-HHMMSS, with -a/-b/... suffixes on collision.
        const base = `${stem}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`
        let fileName = `${base}${ext}`
        let counter = 0
        while (existsSync(join(SCREENSHOT_DIR, fileName))) {
          counter += 1
          fileName = `${base}-${String.fromCharCode(96 + counter)}${ext}`
        }
        try {
          writeFileSync(join(SCREENSHOT_DIR, fileName), buffer)
        } catch (error) {
          return void writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
        writeJson(res, 201, {
          ok: true,
          name: fileName,
          path: join(SCREENSHOT_DIR, fileName),
          url: `${API_PREFIX}/file?name=${encodeURIComponent(fileName)}`,
        })
      },
    },
    {
      kind: "exact",
      path: `${API_PREFIX}/list`,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return void writeJson(res, 403, { error: "forbidden: loopback-only" })
        if ((req.method ?? "GET") !== "GET") return void writeJson(res, 405, { error: `method not allowed: ${req.method}` })
        writeJson(res, 200, { dir: SCREENSHOT_DIR, files: listFiles() })
      },
    },
    {
      kind: "exact",
      path: `${API_PREFIX}/file`,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return void writeJson(res, 403, { error: "forbidden: loopback-only" })
        if ((req.method ?? "GET") !== "GET") return void writeJson(res, 405, { error: `method not allowed: ${req.method}` })
        const url = new URL(req.url ?? "/", "http://localhost")
        const name = safeName(queryParam(url, "name"))
        if (name === undefined) return void writeJson(res, 400, { error: "bad file name" })
        const full = join(SCREENSHOT_DIR, name)
        let stream
        try {
          stream = createReadStream(full)
        } catch {
          return void writeJson(res, 404, { error: "not found" })
        }
        res.writeHead(200, {
          "content-type": mimeForExt(extname(name).toLowerCase()),
          "cache-control": "no-store",
        })
        stream.on("error", () => {
          res.destroy()
        })
        stream.pipe(res)
      },
    },
    {
      kind: "exact",
      path: `${API_PREFIX}/delete`,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return void writeJson(res, 403, { error: "forbidden: loopback-only" })
        if (!isTrustedOrigin(req)) return void writeJson(res, 403, { error: "forbidden: cross-site request" })
        if ((req.method ?? "GET") !== "DELETE") return void writeJson(res, 405, { error: `method not allowed: ${req.method}` })
        const url = new URL(req.url ?? "/", "http://localhost")
        const name = safeName(queryParam(url, "name"))
        if (name === undefined) return void writeJson(res, 400, { error: "bad file name" })
        try {
          unlinkSync(join(SCREENSHOT_DIR, name))
        } catch {
          return void writeJson(res, 404, { error: "not found" })
        }
        writeJson(res, 200, { ok: true })
      },
    },
    {
      kind: "exact",
      path: `${API_PREFIX}/clear`,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return void writeJson(res, 403, { error: "forbidden: loopback-only" })
        if (!isTrustedOrigin(req)) return void writeJson(res, 403, { error: "forbidden: cross-site request" })
        if ((req.method ?? "GET") !== "DELETE") return void writeJson(res, 405, { error: `method not allowed: ${req.method}` })
        for (const file of listFiles()) {
          try {
            unlinkSync(join(SCREENSHOT_DIR, file.name))
          } catch {
            // keep going
          }
        }
        writeJson(res, 200, { ok: true })
      },
    },
    {
      kind: "exact",
      path: `${API_PREFIX}/pending`,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return void writeJson(res, 403, { error: "forbidden: loopback-only" })
        const url = new URL(req.url ?? "/", "http://localhost")
        const method = req.method ?? "GET"
        if (method === "GET") {
          const session = queryParam(url, "session") ?? ""
          writeJson(res, 200, { paths: pendingBySession.get(session) ?? [] })
          return
        }
        if (method === "POST") {
          if (!isTrustedOrigin(req)) return void writeJson(res, 403, { error: "forbidden: cross-site request" })
          const body = await readJsonBody(req)
          if (body === undefined || typeof body.session !== "string" || !Array.isArray(body.paths)) {
            return void writeJson(res, 400, { error: "bad payload" })
          }
          const paths = body.paths
            .filter((p) => p !== null && typeof p === "object" && typeof p.path === "string" && typeof p.label === "string")
            .map((p) => ({ path: p.path, label: p.label }))
          pendingBySession.set(body.session, paths)
          writeJson(res, 200, { ok: true })
          return
        }
        writeJson(res, 405, { error: `method not allowed: ${method}` })
      },
    },
  ]

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, "dsh-screenshot-paste: routes")

  // Deliver pending screenshot references: append the paths to the next user
  // message before the model request (mirrors dsh-plan-mode's append pattern:
  // call next() first, only mutate when the step is accepted), then clear.
  ctx.effect(() => ctx.on(
    "agent/pre-step",
    async (payload, next) => {
      const decision = await next()
      if (decision.kind !== "enter" || payload.signal.aborted) return decision
      const pending = pendingBySession.get(payload.agent.id)
      if (pending === undefined || pending.length === 0) return decision
      const messages = decision.messages
      // Only attach to a step that actually enters a fresh user message
      // (tool-result steps are user-role with a tool source — not a send).
      const lastUser = [...messages].reverse().find(
        (m) => m.role === "user" && m.source?.kind === "user",
      )
      if (lastUser === undefined) return decision
      const text = `\n\n[附件引用]\n${pending.map((p) => p.path).join("\n")}`
      pendingBySession.delete(payload.agent.id)
      return {
        ...decision,
        messages: messages.map((m) =>
          m === lastUser
            ? { ...lastUser, content: [...lastUser.content, { type: "text", text }] }
            : m,
        ),
      }
    },
  ), "dsh-screenshot-paste: pre-step listener")

  // Settings wiring (official ecosystem mechanism): registers the
  // dsh-screenshot-paste namespace so the save directory can be configured
  // from the settings page / ~/.dsh/settings.yaml and hot-applies on change.
  // Dynamic loading keeps link-based dev installs (where the official
  // packages cannot resolve) on the env/default configuration.
  const libs = await loadSettingsLibs()
  if (libs !== false) {
    const { settings, schemastery } = libs
    try {
      const ns = settings.settingsNamespace("dsh-screenshot-paste")
      // schemastery's default export is the Schema function itself; its
      // static methods (object/string/...) build the schema directly.
      const schema = schemastery.object({
        dir: schemastery.string().default(""),
      })
      let readValue = () => ({})
      settings.installSettingsSection(ctx, ns, schema, {}, {
        setSource: (read) => {
          readValue = read
        },
        onChange: () => {
          const value = readValue()
          SCREENSHOT_DIR = resolveScreenshotDir(typeof value?.dir === "string" ? value.dir : "")
        },
      })
    } catch {
      // settings service unavailable — env/default configuration still works
    }
  }
}
