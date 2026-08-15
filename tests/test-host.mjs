// Standalone host-half test: mount the plugin's apply() on a mock ctx,
// serve its routes with plain node:http, and exercise save/list/file/delete/clear.
// Runs against a TEMP directory (DSH_SCREENSHOT_DIR) so the user's real
// screenshots are never touched.
import { createServer } from "node:http"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDir = mkdtempSync(join(tmpdir(), "dsh-shot-test-"))
process.env.DSH_SCREENSHOT_DIR = tempDir

const { apply } = await import(new URL("../lib/index.js", import.meta.url).href)

const routes = []
const preStepListeners = []
const ctx = {
  webServer: {
    register: (route) => {
      routes.push(route)
      return () => {
        const i = routes.indexOf(route)
        if (i >= 0) routes.splice(i, 1)
      }
    },
  },
  effect: (fn) => fn(),
  on: (event, listener) => {
    if (event === "agent/pre-step") {
      preStepListeners.push(listener)
      return () => {
        const i = preStepListeners.indexOf(listener)
        if (i >= 0) preStepListeners.splice(i, 1)
      }
    }
    return () => {}
  },
}
await apply(ctx)
console.log(`registered ${routes.length} route(s): ${routes.map((r) => r.path).join(", ")}`)

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  const route = routes.find((r) => r.kind === "exact" && r.path === url.pathname)
  if (!route) {
    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "no route" }))
    return
  }
  route.handler(req, res)
})
await new Promise((r) => server.listen(18080, "127.0.0.1", r))

const base = "http://127.0.0.1:18080/api/screenshot-paste"
// 1x1 red PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

async function req(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, type: res.headers.get("content-type"), text }
}

try {
  // 1. save
  let r = await req("POST", "/save", { data: PNG, mime: "image/png" })
  console.log("save:", r.status, r.text.slice(0, 200))
  const saved = JSON.parse(r.text)
  if (r.status !== 201 || !saved.ok) throw new Error("save failed")
  if (!/^shot-\d{6}(-[a-z])?\.png$/.test(saved.name)) throw new Error(`unexpected short name: ${saved.name}`)

  // 2. list
  r = await req("GET", "/list")
  console.log("list:", r.status, r.text.slice(0, 300))
  const list = JSON.parse(r.text)
  if (list.files.length !== 1) throw new Error("list count wrong")
  if (list.dir !== tempDir) throw new Error(`dir not overridden: ${list.dir}`)

  // 2b. same-second collision -> -a suffix
  const second = JSON.parse((await req("POST", "/save", { data: PNG, mime: "image/png" })).text)
  console.log("second save (collision):", second.name)
  if (second.name === saved.name) throw new Error("collision suffix missing")

  // 3. file
  r = await req("GET", `/file?name=${encodeURIComponent(saved.name)}`)
  console.log("file:", r.status, r.type, "bytes:", r.text.length)
  if (r.status !== 200 || !r.type.startsWith("image/")) throw new Error("file serve failed")

  // 4. bad name (traversal attempt)
  r = await req("GET", "/file?name=..%5C..%5CWindows%5Cwin.ini")
  console.log("traversal guard:", r.status, r.text.slice(0, 80))
  if (r.status !== 400) throw new Error("traversal guard failed")

  // 5. delete one
  r = await req("DELETE", `/delete?name=${encodeURIComponent(saved.name)}`)
  console.log("delete:", r.status, r.text.slice(0, 80))
  r = await req("GET", "/list")
  if (JSON.parse(r.text).files.length !== 1) throw new Error("delete failed")

  // 6. clear (temp dir only)
  r = await req("DELETE", "/clear")
  console.log("clear:", r.status, r.text.slice(0, 80))
  r = await req("GET", "/list")
  const left = JSON.parse(r.text).files.length
  console.log("final list:", r.status, left, "file(s)")
  if (left !== 0) throw new Error("clear failed")

  // 7. pending store: empty -> set -> get -> per-session isolation -> replace
  r = await req("GET", "/pending?session=sess-a")
  console.log("pending empty:", r.status, r.text)
  if (JSON.parse(r.text).paths.length !== 0) throw new Error("pending not empty initially")

  r = await req("POST", "/pending", { session: "sess-a", paths: [{ path: "F:\\a.png", label: "a.png" }, { path: "F:\\b.png", label: "b.png" }] })
  console.log("pending set:", r.status, r.text)

  r = await req("GET", "/pending?session=sess-a")
  console.log("pending get:", r.status, r.text)
  if (JSON.parse(r.text).paths.length !== 2) throw new Error("pending set failed")

  r = await req("GET", "/pending?session=sess-b")
  if (JSON.parse(r.text).paths.length !== 0) throw new Error("pending not isolated per session")

  r = await req("POST", "/pending", { session: "sess-a", paths: [] })
  r = await req("GET", "/pending?session=sess-a")
  if (JSON.parse(r.text).paths.length !== 0) throw new Error("pending replace failed")
  console.log("pending replace+clear: ok")

  // 8. pre-step append: pending set -> listener appends paths to the fresh
  //    user message and clears the store; tool-result steps must NOT append.
  if (preStepListeners.length !== 1) throw new Error(`expected 1 pre-step listener, got ${preStepListeners.length}`)
  const listener = preStepListeners[0]
  await req("POST", "/pending", { session: "sess-c", paths: [{ path: "F:\\c.png", label: "c.png" }] })
  const userMsg = { id: "m1", role: "user", content: [{ type: "text", text: "看看这张图" }], source: { kind: "user" } }
  const nextEnter = async () => ({ kind: "enter", messages: [userMsg] })
  let decision = await listener(
    { agent: { id: "sess-c" }, messages: [userMsg], turn: 1, step: 1, signal: { aborted: false } },
    nextEnter,
  )
  const appendedText = decision.messages[0].content[1]?.text ?? ""
  console.log("pre-step append text:", JSON.stringify(appendedText))
  if (!appendedText.includes("F:\\c.png")) throw new Error("pre-step append failed")
  r = await req("GET", "/pending?session=sess-c")
  if (JSON.parse(r.text).paths.length !== 0) throw new Error("pending not cleared after append")

  // tool-result step (user-role but tool source) -> no append, pending kept
  await req("POST", "/pending", { session: "sess-c", paths: [{ path: "F:\\c.png", label: "c.png" }] })
  const toolMsg = { id: "m2", role: "user", content: [{ type: "text", text: "tool output" }], source: { kind: "tool" } }
  const nextTool = async () => ({ kind: "enter", messages: [toolMsg] })
  decision = await listener(
    { agent: { id: "sess-c" }, messages: [toolMsg], turn: 1, step: 2, signal: { aborted: false } },
    nextTool,
  )
  if (decision.messages[0].content.length !== 1) throw new Error("tool step must not append")
  r = await req("GET", "/pending?session=sess-c")
  if (JSON.parse(r.text).paths.length !== 1) throw new Error("pending wrongly cleared on tool step")

  // rejected step -> no append, pending kept
  const rejectDecision = await listener(
    { agent: { id: "sess-c" }, messages: [userMsg], turn: 1, step: 3, signal: { aborted: false } },
    async () => ({ kind: "reject" }),
  )
  if (rejectDecision.kind !== "reject") throw new Error("reject must pass through")
  r = await req("GET", "/pending?session=sess-c")
  if (JSON.parse(r.text).paths.length !== 1) throw new Error("pending wrongly cleared on rejected step")
  console.log("pre-step 守卫(工具步骤/拒绝步骤): ok")

  // 9. non-image file upload keeps the original stem + extension
  r = await req("POST", "/save", {
    data: Buffer.from("hello world").toString("base64"),
    mime: "text/plain",
    name: "报告.txt",
  })
  console.log("file save:", r.status, r.text)
  const fileSaved = JSON.parse(r.text)
  if (!/^报告-\d{6}\.txt$/.test(fileSaved.name)) throw new Error(`unexpected file name: ${fileSaved.name}`)
  r = await req("GET", `/file?name=${encodeURIComponent(fileSaved.name)}`)
  if (r.status !== 200 || !String(r.type).includes("text/plain")) throw new Error("file serve failed")
  console.log("file serve:", r.status, r.type)
  await req("DELETE", `/delete?name=${encodeURIComponent(fileSaved.name)}`)

  // 10. unsupported type rejected
  r = await req("POST", "/save", { data: "AA==", mime: "application/x-msdownload", name: "evil.exe" })
  console.log("unsupported type:", r.status, r.text)
  if (r.status !== 400) throw new Error("unsupported type must be rejected")
  console.log("文件上传(原名保留/类型校验): ok")

  console.log("\n✅ 宿主半区全流程测试通过")
} finally {
  server.close()
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // temp cleanup best-effort
  }
}
