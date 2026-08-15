// dsh-screenshot-paste — browser half (runs in the web GUI).
// Screenshot paste board with ZERO footprint on the input draft:
//   - paste (Ctrl+V) or drop one/more images -> saved to F:\dsh-screenshots
//   - references live in a host-side per-session pending store; the chip
//     strip renders ABOVE the input bar (icon + file name + ×) and the input
//     itself stays completely untouched (no chips, no placeholders, caret
//     behaves natively)
//   - on send, the host appends the pending paths to the user message
//     (agent/pre-step listener) and clears the store, so the agent receives
//     the paths without any draft involvement
//   - panel: per-file insert/已引用 state, preview lightbox, delete, clear all
window.__ModuleLoader__.load({
  id: "dsh-screenshot-paste",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const { useCallback, useEffect, useRef, useState } = require("react")
    const { createPortal } = require("react-dom")
    const { createElement: h } = require("react")

    const NS = "screenshot-paste"
    const API = "/api/screenshot-paste"
    const AUTO_INSERT_KEY = "dsh.screenshotPaste.autoInsert"

    const zh = {
      "entry.label": "截图粘贴板",
      "title": "截图粘贴板",
      "subtitle": "粘贴或拖入图片/文件自动保存，引用芯片显示在输入框上方（带 × 可删），发送消息时自动附带文件路径；点击图片芯片可预览。",
      "paste.hint": "在此处按 Ctrl+V 粘贴，或直接拖入图片/文件（支持多张）",
      "list.empty": "还没有截图",
      "auto.insert": "保存后自动加入引用",
      "pending.title": "待发送引用",
      "pending.empty": "（无）",
      "insert.path": "引用",
      "inserted": "已引用 ✓",
      "copied": "已复制 ✓",
      "delete": "删除",
      "clear.all": "清空所有",
      "clear.confirm": "确定要删除全部截图吗？",
      "close": "关闭",
      "preview.close": "关闭预览",
      "browse": "浏览…",
      "save.failed": "保存失败",
      "list.failed": "加载列表失败",
      "dir.hint": "保存目录",
    }
    const en = {
      "entry.label": "Screenshot paste",
      "title": "Screenshot paste",
      "subtitle": "Paste or drop images/files to save them; references show as chips above the input bar (× to remove) and their paths are appended to your next message automatically. Click an image chip to preview.",
      "paste.hint": "Press Ctrl+V here to paste, or drop images/files (multiple supported)",
      "list.empty": "No screenshots yet",
      "auto.insert": "Auto-add reference after save",
      "pending.title": "Pending references",
      "pending.empty": "(none)",
      "insert.path": "Reference",
      "inserted": "Referenced ✓",
      "copied": "Copied ✓",
      "delete": "Delete",
      "clear.all": "Clear all",
      "clear.confirm": "Delete all screenshots?",
      "close": "Close",
      "preview.close": "Close preview",
      "browse": "Browse…",
      "save.failed": "Save failed",
      "list.failed": "Failed to load the list",
      "dir.hint": "Save directory",
    }

    const styles = {
      trigger: {
        width: 30,
        height: 30,
        border: 0,
        background: "transparent",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 14,
        marginLeft: -8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--dsw-alias-label-secondary, #999)",
      },
      mask: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 120,
      },
      panel: {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 500,
        maxWidth: "92vw",
        maxHeight: "84vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--dsw-alias-bg-layer-2, #1e1e1e)",
        border: "1px solid var(--dsw-alias-border-l2, #333)",
        borderRadius: 12,
        zIndex: 121,
        boxShadow: "0 12px 40px rgba(0,0,0,.4)",
        color: "var(--dsw-alias-label-primary, #eee)",
        overflow: "hidden",
      },
      header: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 16px",
        borderBottom: "1px solid var(--dsw-alias-border-l2, #333)",
      },
      title: { flex: 1, fontWeight: 600, fontSize: 14 },
      subtitle: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)", lineHeight: 1.5 },
      body: { padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 },
      pasteZone: {
        border: "2px dashed var(--dsw-alias-border-l2, #444)",
        borderRadius: 10,
        padding: "22px 12px",
        textAlign: "center",
        fontSize: 13,
        color: "var(--dsw-alias-label-tertiary, #999)",
        background: "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.03))",
        outline: "none",
      },
      item: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: 8,
        border: "1px solid var(--dsw-alias-border-l1, #2a2a2a)",
        borderRadius: 8,
        background: "var(--dsw-alias-bg-layer-3, #262626)",
      },
      thumb: {
        width: 56,
        height: 42,
        objectFit: "cover",
        borderRadius: 6,
        background: "#000",
        flex: "none",
        cursor: "zoom-in",
      },
      meta: { flex: 1, minWidth: 0 },
      name: { fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
      dim: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #888)" },
      button: {
        border: "1px solid var(--dsw-alias-border-l2, #444)",
        background: "transparent",
        color: "var(--dsw-alias-label-secondary, #bbb)",
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 12,
        cursor: "pointer",
        flex: "none",
      },
      buttonPrimary: {
        border: "1px solid var(--dsw-alias-button-info-fill, #4d6bfe)",
        background: "var(--dsw-alias-button-info-fill, #4d6bfe)",
        color: "var(--dsw-alias-label-primary-foreground, #fff)",
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 12,
        cursor: "pointer",
        flex: "none",
      },
      buttonDanger: {
        border: "1px solid var(--dsw-alias-state-error-primary, #e5484d)",
        color: "var(--dsw-alias-state-error-primary, #e5484d)",
        background: "transparent",
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 12,
        cursor: "pointer",
        flex: "none",
      },
      chip: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        maxWidth: "100%",
        background: "var(--dsw-alias-interactive-bg-hover-accent, rgba(77,107,254,.15))",
        border: "1px solid var(--dsw-alias-border-l2, #444)",
        borderRadius: 999,
        padding: "3px 10px",
        fontSize: 12,
      },
      chipRemove: {
        border: 0,
        background: "transparent",
        color: "var(--dsw-alias-label-tertiary, #999)",
        cursor: "pointer",
        fontSize: 13,
        lineHeight: 1,
        padding: "0 2px",
      },
      footer: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
        fontSize: 12,
        color: "var(--dsw-alias-label-tertiary, #888)",
      },
      empty: { textAlign: "center", padding: 14, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" },
      checkboxRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" },
      pendingBox: {
        border: "1px solid var(--dsw-alias-border-l1, #2a2a2a)",
        borderRadius: 8,
        padding: 8,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        background: "var(--dsw-alias-bg-layer-3, #262626)",
      },
      lightbox: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.78)",
        zIndex: 130,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
      lightboxImg: { maxWidth: "90vw", maxHeight: "88vh", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,.6)" },
      // Aligned to the input card via the platform's own composer geometry
      // vars (same pattern as the built-in QueueDock): card width minus dock
      // insets, centered with margin auto.
      dock: {
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        boxSizing: "border-box",
        width: "calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) * 2)",
        maxWidth: "100%",
        margin: "0 auto",
        padding: "0 var(--dsh-composer-dock-inset)",
      },
    }

    async function api(path, options) {
      const res = await fetch(`${API}${path}`, options)
      const text = await res.text()
      let payload = null
      try {
        payload = JSON.parse(text)
      } catch {
        payload = null
      }
      if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`)
      return payload
    }

    async function getPendingRemote(session) {
      try {
        const payload = await api(`/pending?session=${encodeURIComponent(session)}`)
        return Array.isArray(payload?.paths) ? payload.paths : []
      } catch {
        return []
      }
    }

    async function setPendingRemote(session, paths) {
      await api("/pending", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session, paths }),
      })
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        const area = document.createElement("textarea")
        area.value = text
        area.style.position = "fixed"
        area.style.opacity = "0"
        document.body.appendChild(area)
        area.select()
        let ok = false
        try {
          ok = document.execCommand("copy")
        } catch {
          ok = false
        }
        area.remove()
        return ok
      }
    }

    function shortLabel(path) {
      const parts = path.split(/[\\/]/)
      return parts[parts.length - 1] ?? path
    }

    /** Whether a stored file name is a previewable image. */
    function isImageName(name) {
      return /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)
    }

    /**
     * The chip strip ABOVE the input bar (conversation.input.dock, session
     * scope). Reads the host-side pending store for this session; chips show
     * an icon, the file name, and an × that removes the reference. Aligns
     * itself to the input card's left edge via the composer geometry vars.
     */
    function DockStrip({ useSession, t }) {
      const L = (key) => (typeof t === "function" ? t(key) : key)
      const sessionId = typeof useSession === "function" ? useSession((s) => s.sessionId) : undefined
      const [pending, setPending] = useState([])
      const [preview, setPreview] = useState(null)

      const load = useCallback(async () => {
        if (sessionId === undefined) {
          setPending([])
          return
        }
        setPending(await getPendingRemote(sessionId))
      }, [sessionId])

      useEffect(() => {
        load()
        const timer = window.setInterval(load, 1500)
        return () => window.clearInterval(timer)
      }, [load])

      if (pending.length === 0) return null

      const remove = async (path) => {
        try {
          await setPendingRemote(sessionId, pending.filter((p) => p.path !== path))
          load()
        } catch {
          // ignore
        }
      }

      const previewUrl = (path) => `${API}/file?name=${encodeURIComponent(shortLabel(path))}`

      const dockRow = h(
        "div",
        { style: styles.dock },
        pending.map((p) => {
          const image = isImageName(p.path)
          return h(
            "span",
            {
              key: p.path,
              style: { ...styles.chip, ...(image ? { cursor: "zoom-in" } : {}) },
              title: p.path,
              onClick: image ? () => setPreview({ url: previewUrl(p.path), label: p.label }) : undefined,
            },
            h("span", { style: { fontSize: 12 } }, image ? "🖼️" : "📄"),
            h(
              "span",
              { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 } },
              p.label,
            ),
            h(
              "button",
              {
                type: "button",
                style: styles.chipRemove,
                "aria-label": L("delete"),
                onClick: (event) => {
                  event.stopPropagation()
                  void remove(p.path)
                },
              },
              "×",
            ),
          )
        }),
      )

      return h(
        "div",
        { style: { display: "contents" } },
        dockRow,
        preview !== null
          ? createPortal(
            h(
              "div",
              { style: styles.lightbox, onClick: () => setPreview(null) },
              h("img", { src: preview.url, alt: preview.label, style: styles.lightboxImg }),
            ),
            document.body,
          )
          : null,
      )
    }

    /**
     * The sidebar footer entry + the paste-board modal. Component-local state
     * only; references are managed through the host pending store via the
     * inject face (the input machine is never touched).
     */
    function ScreenshotEntry({ wide, t, insertPath, removePath, getPending }) {
      const L = (key) => (typeof t === "function" ? t(key) : key)
      const [open, setOpen] = useState(false)
      const [files, setFiles] = useState([])
      const [dir, setDir] = useState("")
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState("")
      const [pasted, setPasted] = useState(false)
      const [pending, setPending] = useState([])
      const [flashPath, setFlashPath] = useState("")
      const [preview, setPreview] = useState(null)
      const [autoInsert, setAutoInsert] = useState(() => {
        try {
          return localStorage.getItem(AUTO_INSERT_KEY) !== "0"
        } catch {
          return true
        }
      })
      const pasteRef = useRef(null)
      const fileInputRef = useRef(null)
      const refreshToken = useRef(0)

      const isInserted = useCallback((path) => pending.some((p) => p.path === path), [pending])

      const syncPending = useCallback(async () => {
        try {
          const list = typeof getPending === "function" ? await getPending() : []
          setPending(list)
        } catch {
          setPending([])
        }
      }, [getPending])

      const refresh = useCallback(async () => {
        const token = ++refreshToken.current
        try {
          const payload = await api("/list")
          if (token !== refreshToken.current) return
          setDir(payload.dir ?? "")
          setFiles(payload.files ?? [])
          setError("")
        } catch {
          if (token !== refreshToken.current) return
          setError(L("list.failed"))
        }
        void syncPending()
      }, [L, syncPending])

      const saveOne = useCallback(async (file) => {
        const dataUrl = await new Promise((resolvePromise, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolvePromise(String(reader.result ?? ""))
          reader.onerror = () => reject(new Error("read failed"))
          reader.readAsDataURL(file)
        })
        const comma = dataUrl.indexOf(",")
        const mime = dataUrl.slice(5, comma).split(";")[0]
        const base64 = dataUrl.slice(comma + 1)
        const saved = await api("/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: base64, mime, name: file.name }),
        })
        return saved
      }, [])

      const uploadFiles = useCallback(
        async (fileList) => {
          const files = Array.from(fileList)
          if (files.length === 0) return
          setBusy(true)
          setError("")
          try {
            const saved = []
            for (const file of files) {
              try {
                saved.push(await saveOne(file))
              } catch {
                // keep going with the rest
              }
            }
            if (saved.length > 0) {
              setPasted(true)
              window.setTimeout(() => setPasted(false), 1500)
            }
            if (autoInsert && typeof insertPath === "function") {
              for (const item of saved) {
                try {
                  await insertPath(item.path, shortLabel(item.name))
                } catch {
                  // keep going
                }
              }
            }
            await refresh()
          } catch {
            setError(L("save.failed"))
          } finally {
            setBusy(false)
          }
        },
        [autoInsert, insertPath, L, refresh, saveOne],
      )

      const onPaste = useCallback(
        (event) => {
          const filesList = []
          const items = event.clipboardData?.items ?? []
          for (const item of items) {
            if (item.kind !== "file") continue
            const file = item.getAsFile()
            if (file && /^image\//.test(file.type)) filesList.push(file)
          }
          if (filesList.length === 0) return
          event.preventDefault()
          void uploadFiles(filesList)
        },
        [uploadFiles],
      )

      const onDrop = useCallback(
        (event) => {
          event.preventDefault()
          const dropped = event.dataTransfer?.files ?? []
          void uploadFiles(dropped)
        },
        [uploadFiles],
      )

      const handleInsertOne = useCallback(
        async (file) => {
          if (isInserted(file.path)) return
          try {
            if (typeof insertPath === "function" && (await insertPath(file.path, shortLabel(file.name)))) {
              await syncPending()
              return
            }
          } catch {
            // fall through to clipboard
          }
          const ok = await copyText(file.path)
          if (ok) {
            setFlashPath(file.path)
            window.setTimeout(() => setFlashPath(""), 1500)
          }
        },
        [insertPath, isInserted, syncPending],
      )

      const handleRemovePending = useCallback(
        async (path) => {
          try {
            if (typeof removePath === "function") await removePath(path)
          } catch {
            // ignore
          }
          await syncPending()
        },
        [removePath, syncPending],
      )

      const handleDelete = useCallback(
        async (file) => {
          try {
            await api(`/delete?name=${encodeURIComponent(file.name)}`, { method: "DELETE" })
            await refresh()
          } catch {
            setError(L("save.failed"))
          }
        },
        [L, refresh],
      )

      const handleClear = useCallback(async () => {
        if (typeof window !== "undefined" && !window.confirm(L("clear.confirm"))) return
        try {
          await api("/clear", { method: "DELETE" })
          await refresh()
        } catch {
          setError(L("save.failed"))
        }
      }, [L, refresh])

      const openPanel = useCallback(() => {
        setOpen(true)
        void refresh()
      }, [refresh])

      const closePanel = useCallback(() => {
        setOpen(false)
        setPreview(null)
      }, [])

      const toggleAutoInsert = useCallback(() => {
        setAutoInsert((prev) => {
          const next = !prev
          try {
            localStorage.setItem(AUTO_INSERT_KEY, next ? "1" : "0")
          } catch {
            // storage unavailable — keep in-memory state
          }
          return next
        })
      }, [])

      useEffect(() => {
        if (!open) return
        const timer = window.setTimeout(() => pasteRef.current?.focus(), 60)
        const interval = window.setInterval(() => void syncPending(), 1500)
        return () => {
          window.clearTimeout(timer)
          window.clearInterval(interval)
        }
      }, [open, syncPending])

      useEffect(() => () => { refreshToken.current++ }, [])

      const fmtSize = (bytes) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
      }
      const fmtTime = (ms) => {
        const d = new Date(ms)
        const pad = (n) => String(n).padStart(2, "0")
        return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      }

      // Upright paperclip glyph, rotated 180° (loop at the bottom), strokes
      // follow the theme color.
      const triggerIcon = h(
        "svg",
        {
          width: 16,
          height: 16,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "block" },
        },
        h("path", {
          d: "M5.5 20.5v-13a6.5 6.5 0 0 1 13 0v11a4.5 4.5 0 0 1-9 0v-9a2.5 2.5 0 0 1 5 0v8.5",
          transform: "rotate(180 12 12)",
        }),
      )

      const trigger = h(
        "button",
        {
          type: "button",
          style: styles.trigger,
          "aria-label": L("entry.label"),
          title: L("entry.label"),
          onClick: openPanel,
        },
        triggerIcon,
      )

      if (!open) return trigger

      const browseRow = h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8 } },
        h(
          "button",
          { type: "button", style: styles.button, onClick: () => fileInputRef.current?.click() },
          L("browse"),
        ),
        h(
          "input",
          {
            ref: fileInputRef,
            type: "file",
            multiple: true,
            style: { display: "none" },
            onChange: (event) => {
              const picked = event.target.files ?? []
              if (picked.length > 0) void uploadFiles(picked)
              event.target.value = ""
            },
          },
        ),
      )

      const pasteZone = h(
        "div",
        {
          ref: pasteRef,
          tabIndex: 0,
          style: styles.pasteZone,
          onPaste: onPaste,
          onDrop: onDrop,
          onDragOver: (event) => event.preventDefault(),
        },
        busy ? "保存中…" : pasted ? "已保存 ✓" : L("paste.hint"),
      )

      const pendingStrip = h(
        "div",
        { style: styles.pendingBox },
        h("span", { style: styles.dim }, L("pending.title")),
        pending.length === 0
          ? h("span", { style: styles.dim }, L("pending.empty"))
          : pending.map((p) => h(
            "span",
            { key: p.path, style: styles.chip, title: p.path },
            h("span", { style: { fontSize: 12 } }, isImageName(p.path) ? "🖼️" : "📄"),
            h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 } }, p.label),
            h(
              "button",
              {
                type: "button",
                style: styles.chipRemove,
                "aria-label": L("delete"),
                onClick: () => void handleRemovePending(p.path),
              },
              "×",
            ),
          )),
      )

      const list = files.length === 0
        ? h("div", { style: styles.empty }, L("list.empty"))
        : files.map((file) => h(
          "div",
          { key: file.name, style: styles.item },
          isImageName(file.name)
            ? h("img", {
              src: file.url,
              alt: file.name,
              style: styles.thumb,
              onClick: () => setPreview(file),
            })
            : h(
              "div",
              {
                style: {
                  ...styles.thumb,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  cursor: "default",
                },
                title: file.name,
              },
              "📄",
            ),
          h(
            "div",
            { style: styles.meta },
            h("div", { style: styles.name, title: file.path }, file.name),
            h("div", { style: styles.dim }, `${fmtSize(file.size)} · ${fmtTime(file.mtime)}`),
          ),
          h(
            "button",
            {
              type: "button",
              style: isInserted(file.path)
                ? { ...styles.buttonPrimary, opacity: 0.55, cursor: "default" }
                : styles.buttonPrimary,
              disabled: isInserted(file.path),
              onClick: () => void handleInsertOne(file),
            },
            isInserted(file.path)
              ? L("inserted")
              : flashPath === file.path ? L("copied") : L("insert.path"),
          ),
          h(
            "button",
            { type: "button", style: styles.button, onClick: () => void handleDelete(file) },
            L("delete"),
          ),
        ))

      const panel = h(
        "div",
        { style: styles.panel },
        h(
          "div",
          { style: styles.header },
          h("span", { style: styles.title }, L("title")),
          h(
            "label",
            { style: styles.checkboxRow },
            h("input", { type: "checkbox", checked: autoInsert, onChange: toggleAutoInsert }),
            L("auto.insert"),
          ),
          h(
            "button",
            { type: "button", style: styles.button, onClick: closePanel, "aria-label": L("close") },
            "✕",
          ),
        ),
        h("div", { style: { padding: "0 16px" } }, h("p", { style: styles.subtitle }, L("subtitle"))),
        h(
          "div",
          { style: styles.body },
          pasteZone,
          browseRow,
          pendingStrip,
          error !== "" ? h("div", { style: { ...styles.dim, color: "var(--dsw-alias-state-error-primary, #e5484d)" } }, error) : null,
          list,
        ),
        h(
          "div",
          { style: styles.footer },
          h("span", { style: { flex: 1 } }, `${L("dir.hint")}: ${dir || "F:\\dsh-screenshots"}`),
          files.length > 0
            ? h("button", { type: "button", style: styles.buttonDanger, onClick: () => void handleClear() }, L("clear.all"))
            : null,
        ),
      )

      return h(
        "div",
        { style: { display: "contents" } },
        trigger,
        createPortal(
          h(
            "div",
            { style: { position: "fixed", inset: 0, zIndex: 119 } },
            h("div", { style: styles.mask, onClick: closePanel }),
            panel,
            preview !== null
              ? h(
                "div",
                { style: styles.lightbox, onClick: () => setPreview(null) },
                h("img", { src: preview.url, alt: preview.name, style: styles.lightboxImg }),
              )
              : null,
          ),
          document.body,
        ),
      )
    }

    /**
     * Register the screenshot paste board: dictionaries, the sidebar footer
     * entry whose inject face manages the host pending store, and the chip
     * strip above the input bar. The input machine is never touched.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-screenshot-paste: dictionaries")

      const currentSessionId = () => ctx.get("sessions")?.list?.getSnapshot()?.current

      // The entry trigger + panel, mounted in the input bar's left seat
      // (renders right after the Full access / modes group). Single entry.
      ctx.slots.inject("conversation.input.left", () =>
        ctx.slots.register(
          {
            name: "conversation.input.left",
            id: "screenshot-paste",
            locale: NS,
            inject: () => ({
              /** Add one reference to the current session's pending store. */
              insertPath: async (path, label) => {
                const session = currentSessionId()
                if (session === undefined) return false
                try {
                  const current = await getPendingRemote(session)
                  if (current.some((p) => p.path === path)) return true
                  await setPendingRemote(session, [...current, { path, label: label ?? path }])
                  return true
                } catch {
                  return false
                }
              },
              /** Remove one reference from the current session's pending store. */
              removePath: async (path) => {
                const session = currentSessionId()
                if (session === undefined) return false
                try {
                  const current = await getPendingRemote(session)
                  await setPendingRemote(session, current.filter((p) => p.path !== path))
                  return true
                } catch {
                  return false
                }
              },
              /** Read the current session's pending references. */
              getPending: async () => {
                const session = currentSessionId()
                if (session === undefined) return []
                return getPendingRemote(session)
              },
            }),
          },
          ScreenshotEntry,
        ),
      )

      // The chip strip above the input bar (hidden when no references).
      ctx.slots.inject("conversation.input.dock", () =>
        ctx.slots.register({ name: "conversation.input.dock", id: "screenshot-paste", locale: NS }, DockStrip),
      )
    }

    const inject = ["slots", "locale"]

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
