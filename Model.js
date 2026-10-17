// Pure functions for the workspace manager. Loaded by Overlay.qml and by Node vm tests.
// No Node APIs. No QML types.
// Hyprland owns placement. This only reads its clients, workspaces and monitors
// and builds dispatches that move windows between the ordinary workspaces 1-10.
// Scratchpad and other special workspaces are never shown or touched.

var MAX_COMPOSITOR_OUTPUT_BYTES_VALUE = 1024 * 1024
var MAX_QUERY_CHARS_VALUE = 128
var MAX_COMPOSITOR_TEXT_CHARS_VALUE = 512
var MAX_MONITOR_NAME_CHARS_VALUE = 128
var MAX_WORKSPACE_NAME_CHARS_VALUE = 192
var MAX_ADDRESS_CHARS_VALUE = 128
var MAX_STAGE_CLIENTS_VALUE = 512
var MAX_STAGE_WORKSPACES_VALUE = 1024
var MAX_STAGE_MONITORS_VALUE = 32
var MAX_RENDERED_PANES_PER_TILE_VALUE = 32
var MAX_LAYOUT_ROWS_VALUE = 10
var MAX_NUMERIC_MAGNITUDE_VALUE = 1000000000

function maxCompositorOutputBytes() {
  return MAX_COMPOSITOR_OUTPUT_BYTES_VALUE
}

function maxCompositorTextChars() {
  return MAX_COMPOSITOR_TEXT_CHARS_VALUE
}

function maxStageClients() {
  return MAX_STAGE_CLIENTS_VALUE
}

function maxStageWorkspaces() {
  return MAX_STAGE_WORKSPACES_VALUE
}

function maxStageMonitors() {
  return MAX_STAGE_MONITORS_VALUE
}

function maxRenderedPanesPerTile() {
  return MAX_RENDERED_PANES_PER_TILE_VALUE
}

function isWithinUtf8ByteLimit(value, limit) {
  var text = typeof value === "string" ? value : String(value == null ? "" : value)
  var cap = Number(limit)
  if (!isFinite(cap) || cap < 0) return false
  var bytes = 0
  var i
  for (i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      var next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
    if (bytes > cap) return false
  }
  return true
}

function boundedHyprctlArgv(query) {
  var name = String(query || "")
  if (name !== "clients" && name !== "workspaces" && name !== "monitors") return []
  return [
    "bash",
    "-o",
    "pipefail",
    "-c",
    "hyprctl -j \"$1\" 2>/dev/null | head -c \"$2\"",
    "omadesk-hyprctl",
    name,
    String(MAX_COMPOSITOR_OUTPUT_BYTES_VALUE + 1)
  ]
}

function normalizeQuery(raw) {
  return boundedText(raw, MAX_QUERY_CHARS_VALUE, "").replace(/\s+/g, " ").trim()
}

function scoreText(query, text) {
  var needle = boundedText(query, MAX_QUERY_CHARS_VALUE, "").toLowerCase()
  var hay = boundedText(text, MAX_QUERY_CHARS_VALUE, "").toLowerCase()
  if (needle === "") return 1
  if (hay === needle) return 100
  if (hay.indexOf(needle) === 0) return 80
  if (hay.indexOf(needle) >= 0) return 50
  return 0
}

function moveCursor(index, keyOrCount, countOrDx, columnsOrDy, maybeColumns) {
  var i = Number(index)
  if (!isFinite(i)) i = 0
  var total
  var cols
  var delta = 0
  if (typeof keyOrCount === "number") {
    total = Number(keyOrCount)
    var dx = Number(countOrDx)
    var dy = Number(columnsOrDy)
    cols = Number(maybeColumns)
    if (!isFinite(cols) || cols < 1) cols = 2
    if (!isFinite(total) || total < 1) return 0
    if (isFinite(dx)) delta += dx
    if (isFinite(dy)) delta += dy * cols
  } else {
    total = Number(countOrDx)
    cols = Number(columnsOrDy)
    if (!isFinite(cols) || cols < 1) cols = 2
    if (!isFinite(total) || total < 1) return 0
    var k = String(keyOrCount || "").toLowerCase()
    if (k === "h" || k === "left") delta = -1
    else if (k === "l" || k === "right") delta = 1
    else if (k === "k" || k === "up") delta = -cols
    else if (k === "j" || k === "down") delta = cols
  }
  i = i + delta
  if (i < 0) i = 0
  if (i > total - 1) i = total - 1
  return i
}

// Index of the tile showing workspace n, or the current index when n has none.
function tileIndexForN(tiles, n, current) {
  var want = Number(n)
  var list = isArray(tiles) ? tiles : []
  var i
  for (i = 0; i < list.length; i++) {
    if (list[i] && Number(list[i].n) === want) return i
  }
  var cur = Number(current)
  if (!isFinite(cur) || cur < 0) return 0
  return cur
}

function emptyStage(valid) {
  return {
    valid: valid !== false,
    workspaces: [],
    windows: [],
    layout: [],
    monitors: [],
    monitorSizes: {},
    layoutMeta: {},
    lastWorkspace: null
  }
}

function parseStage(clientsJson, workspacesJson, monitorsJson) {
  if (typeof clientsJson === "string" &&
      !isWithinUtf8ByteLimit(clientsJson, MAX_COMPOSITOR_OUTPUT_BYTES_VALUE)) return emptyStage(false)
  if (typeof workspacesJson === "string" &&
      !isWithinUtf8ByteLimit(workspacesJson, MAX_COMPOSITOR_OUTPUT_BYTES_VALUE)) return emptyStage(false)
  if (typeof monitorsJson === "string" &&
      !isWithinUtf8ByteLimit(monitorsJson, MAX_COMPOSITOR_OUTPUT_BYTES_VALUE)) return emptyStage(false)
  var clientsResult = parseJsonList(clientsJson, MAX_STAGE_CLIENTS_VALUE)
  var workspacesResult = parseJsonList(workspacesJson, MAX_STAGE_WORKSPACES_VALUE)
  var monitorsResult = parseJsonList(monitorsJson, MAX_STAGE_MONITORS_VALUE)
  if (!clientsResult.ok || !workspacesResult.ok || !monitorsResult.ok) return emptyStage(false)
  var clients = clientsResult.list
  var workspaces = workspacesResult.list
  var monitorsInput = monitorsResult.list
  var layout = parseLayout(monitorsInput, workspaces)
  var layouts = workspaceLayoutIndex(workspaces)
  var monitors = connectedMonitorNames(monitorsInput, workspaces)
  var groups = {}
  var windows = []
  var i
  for (i = 0; i < clients.length; i++) {
    var client = clients[i]
    var n = clientWorkspaceN(client)
    if (n < 1 || n > 10) continue
    var win = copyGeom({
      address: boundedToken(client.address, MAX_ADDRESS_CHARS_VALUE),
      class: boundedText(client.class, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
      initialClass: boundedText(client.initialClass, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
      title: boundedText(client.title, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
      floating: !!client.floating,
      monitor: monitorName(client, workspaces),
      workspace: n
    }, client)
    windows.push(win)
    if (!groups[n]) groups[n] = []
    groups[n].push(win)
  }
  var wsOut = []
  for (n = 1; n <= 10; n++) {
    if (groups[n] && groups[n].length) {
      var numMeta = layouts.numbered[n] || {}
      wsOut.push({
        n: n,
        windows: groups[n],
        monitor: monitorForWorkspace(n, layout, groups[n], workspaces),
        hyprId: numMeta.hyprId != null ? numMeta.hyprId : n,
        tiledLayout: numMeta.tiledLayout || "dwindle"
      })
    }
  }
  return {
    valid: true,
    workspaces: wsOut,
    windows: windows,
    layout: layout,
    monitors: monitors,
    monitorSizes: parseMonitorSizes(monitorsInput),
    layoutMeta: layouts.numbered,
    lastWorkspace: pickLastWorkspace(workspaces, wsOut, layout)
  }
}

function normalizeTiledLayout(value) {
  var s = String(value || "").toLowerCase()
  if (s === "scrolling" || s === "scroll") return "scrolling"
  return "dwindle"
}

function nextTiledLayout(value) {
  return normalizeTiledLayout(value) === "scrolling" ? "dwindle" : "scrolling"
}

function hasHyprWorkspaceId(hyprId) {
  if (hyprId == null || hyprId === "") return false
  var n = Number(hyprId)
  return isFinite(n) && n !== 0
}

function workspaceLayoutTarget(tile) {
  var n = focusWorkspaceN(tile && tile.n != null ? tile.n : tile)
  if (!n) return ""
  var id = tile && tile.hyprId
  if (hasHyprWorkspaceId(id) && Number(id) > 0) return String(Number(id))
  return String(n)
}

function workspaceLayoutPersistId(target) {
  var t = boundedToken(target, MAX_WORKSPACE_NAME_CHARS_VALUE)
  if (!t) return ""
  if (t.indexOf("special:") === 0) t = t.slice(8)
  if (/^[0-9]+$/.test(t)) return t
  if (/^-/.test(t)) return ""
  t = t.replace(/[^A-Za-z0-9._-]+/g, "-")
  t = t.replace(/^-+/, "").replace(/-+$/, "")
  return t
}

// Hyprland reads a leading "-" as a workspace offset relative to the focused
// workspace, so "-98" resolves to "98 workspaces back", clamped to workspace 1.
// A rule persisted under a bare negative id therefore retargets workspace 1 on
// every config reload instead of the special workspace it came from.
function workspaceLayoutSelector(target) {
  var ws = safeDispatchToken(target)
  if (!ws) return ""
  if (/^-/.test(ws)) return ""
  return ws
}

function workspaceLayoutRuleLua(target, layout) {
  var ws = workspaceLayoutSelector(target)
  if (!ws) return ""
  return "hl.workspace_rule({ workspace = \"" + ws + "\", layout = \"" + normalizeTiledLayout(layout) + "\" })\n"
}

function workspaceLayoutsDir(home, stateHome) {
  var xdg = String(stateHome || "").trim()
  if (xdg) return xdg + "/omarchy/workspace-layouts"
  return String(home || "") + "/.local/state/omarchy/workspace-layouts"
}

function workspaceLayoutApplyArgv(dir, target, layout) {
  var folder = String(dir || "")
  var ws = workspaceLayoutPersistId(target)
  if (!folder || !ws) return []
  var lua = workspaceLayoutRuleLua(target, layout).replace(/\n+$/, "")
  if (!lua) return []
  // Files named after a bare negative id hold a relative selector that steals
  // workspace 1 every time Omarchy's loader re-runs the directory, so drop them
  // and reload once so the stale rules leave the running compositor too.
  return [
    "bash",
    "-c",
    "mkdir -p -- \"$1\" || exit 0; cleaned=0; for f in \"$1\"/-*.lua; do [ -f \"$f\" ] || continue; cleaned=1; rm -f -- \"$f\"; done; printf '%s\\n' \"$2\" > \"$3\" || exit 0; hyprctl eval \"$2\" >/dev/null 2>&1 || true; if [ \"$cleaned\" = 1 ]; then hyprctl reload config-only >/dev/null 2>&1 || true; fi; exit 0",
    "omadesk-layout",
    folder,
    lua,
    folder + "/" + ws + ".lua"
  ]
}

function workspaceLayoutIndex(workspacesJson) {
  var list = parseJsonArg(workspacesJson, MAX_STAGE_WORKSPACES_VALUE)
  var numbered = {}
  var i
  for (i = 0; i < list.length; i++) {
    var ws = list[i]
    if (!ws) continue
    var meta = {
      hyprId: ws.id,
      tiledLayout: normalizeTiledLayout(ws.tiledLayout)
    }
    var n = numberedWorkspaceId(ws)
    if (n) numbered[n] = meta
  }
  return { numbered: numbered }
}

function moveDispatch(workspaceSelector, address) {
  var ws = safeDispatchToken(workspaceSelector)
  var addr = windowSelector(address)
  if (!ws || !addr) return ""
  return "hl.dsp.window.move({ workspace = \"" + ws + "\", follow = false, window = \"" + addr + "\" })"
}

function windowMoveDispatch(address, fromN, toN) {
  var dest = focusWorkspaceN(toN)
  if (!dest || !windowSelector(address)) return ""
  var src = focusWorkspaceN(fromN)
  if (src && src === dest) return ""
  return moveDispatch(String(dest), address)
}

function focusDispatch(workspaceSelector) {
  var ws = safeDispatchToken(workspaceSelector)
  if (!ws) return ""
  return "hl.dsp.focus({ workspace = \"" + ws + "\" })"
}

function safeDispatchToken(value) {
  return boundedToken(value, MAX_WORKSPACE_NAME_CHARS_VALUE)
}

function safeMonitor(name) {
  return boundedToken(name, MAX_MONITOR_NAME_CHARS_VALUE)
}

function focusWorkspaceN(value) {
  var n = Number(value)
  if (isFinite(n) && n >= 1 && n <= 10) return n
  return null
}

function iconName(win) {
  var names = iconNames(win)
  return names.length ? names[0] : ""
}

function iconNames(win) {
  var cls = boundedText((win && (win.class || win.initialClass)), MAX_COMPOSITOR_TEXT_CHARS_VALUE, "")
  var lower = cls.toLowerCase()
  var last = lastClassSegment(lower)
  var out = []
  var mapped = mappedIcon(lower, last)
  if (mapped) out.push(mapped)
  if (cls && out.indexOf(cls) === -1) out.push(cls)
  if (last && out.indexOf(last) === -1) out.push(last)
  return out
}

function mappedIcon(lower, last) {
  var s = String(lower || "")
  var tail = String(last || "")
  if (s.indexOf("geforce") >= 0) return "com.nvidia.geforcenow"
  if (s.indexOf("chrome-") === 0) return "chromium"
  if (s.indexOf("ghostty") >= 0 || tail === "ghostty") return "com.mitchellh.ghostty"
  if (tail === "zed") return "zed"
  if (tail === "chromium" || tail === "chrome" || tail === "google-chrome") return "chromium"
  if (tail === "firefox" || tail === "firefox-esr") return "firefox"
  if (tail === "nautilus") return "org.gnome.Nautilus"
  if (tail === "code" || s === "code - oss") return "code"
  if (s.indexOf("obsproject") >= 0) return "com.obsproject.Studio"
  return ""
}

// Placement lives in Hyprland, so a workspace move is a batch of window
// dispatches rather than an edit to stored state. Both planners read addresses
// from the pre-move stage: every dispatch names one window, so the compositor
// can apply them in any order without the sets bleeding into each other.

function workspaceAddresses(stage, n) {
  var want = focusWorkspaceN(n)
  var out = []
  if (!want) return out
  var live = stageWindows(stage)
  var i
  for (i = 0; i < live.length && out.length < MAX_STAGE_CLIENTS_VALUE; i++) {
    if (!live[i] || !live[i].address) continue
    if (clientWorkspaceN(live[i]) !== want) continue
    out.push(boundedToken(live[i].address, MAX_ADDRESS_CHARS_VALUE))
  }
  return out
}

function packMovePlan(dispatches) {
  return { dispatches: dispatches, batch: joinBatch(dispatches) }
}

function swapWorkspacePlan(stage, aN, bN) {
  var a = focusWorkspaceN(aN)
  var b = focusWorkspaceN(bN)
  if (!a || !b || a === b) return packMovePlan([])
  var aSel = String(a)
  var bSel = String(b)
  var aWins = workspaceAddresses(stage, a)
  var bWins = workspaceAddresses(stage, b)
  var dispatches = []
  var i
  var lua
  for (i = 0; i < aWins.length; i++) {
    lua = moveDispatch(bSel, aWins[i])
    if (lua) dispatches.push(lua)
  }
  for (i = 0; i < bWins.length; i++) {
    lua = moveDispatch(aSel, bWins[i])
    if (lua) dispatches.push(lua)
  }
  return packMovePlan(dispatches)
}

function boundedText(value, maxChars, fallback) {
  if (value == null) return fallback == null ? "" : String(fallback)
  var type = typeof value
  if (type !== "string" && type !== "number" && type !== "boolean") {
    return fallback == null ? "" : String(fallback)
  }
  var text = String(value)
  var cap = Number(maxChars)
  if (!isFinite(cap) || cap < 0) return fallback == null ? "" : String(fallback)
  if (text.length <= cap) return text
  text = text.slice(0, cap)
  if (text.length && /[\ud800-\udbff]/.test(text.charAt(text.length - 1))) {
    text = text.slice(0, -1)
  }
  return text
}

function boundedToken(value, maxChars) {
  if (value == null) return ""
  var type = typeof value
  if (type !== "string" && type !== "number") return ""
  var text = String(value)
  if (text.length > Number(maxChars)) return ""
  if (/["\\\u0000-\u001f\u007f]/.test(text)) return ""
  return text
}

function isArray(value) {
  if (typeof Array !== "undefined" && typeof Array.isArray === "function") {
    return Array.isArray(value)
  }
  return Object.prototype.toString.call(value) === "[object Array]"
}

function errorMessage(err) {
  if (!err) return "unknown error"
  if (err.message) return String(err.message)
  return String(err)
}

function parseJsonList(value, maxCount) {
  if (value == null || value === "") return { ok: true, list: [] }
  var parsed = value
  if (typeof value === "string") {
    var trimmed = value.replace(/^\s+|\s+$/g, "")
    if (trimmed === "") return { ok: true, list: [] }
    try {
      parsed = JSON.parse(trimmed)
    } catch (err) {
      return { ok: false, list: [] }
    }
  }
  var list = null
  if (isArray(parsed)) list = parsed
  if (parsed && typeof parsed === "object") {
    if (isArray(parsed.workspaces)) list = parsed.workspaces
    else if (isArray(parsed.clients)) list = parsed.clients
    else if (parsed.id != null || parsed.address != null) list = [parsed]
  }
  if (!list) return { ok: false, list: [] }
  var cap = Number(maxCount)
  if (isFinite(cap) && cap >= 0 && list.length > cap) return { ok: false, list: [] }
  return { ok: true, list: list }
}

function parseJsonArg(value, maxCount) {
  return parseJsonList(value, maxCount).list
}

function workspaceBareName(name) {
  var nm = boundedToken(name, MAX_WORKSPACE_NAME_CHARS_VALUE)
  if (nm.indexOf("name:") === 0) nm = nm.slice(5)
  return nm
}

function isDroppedName(name) {
  var nm = workspaceBareName(name)
  if (nm.indexOf("special:") === 0) return true
  if (nm === "special") return true
  return false
}

function numberedWorkspaceId(ws) {
  if (ws == null || ws === "") return 0
  if (typeof ws === "number" || (typeof ws === "string" && /^[0-9]+$/.test(ws))) {
    var direct = Number(ws)
    if (direct >= 1 && direct <= 10) return direct
    return 0
  }
  var name = workspaceBareName(ws.name)
  if (isDroppedName(name)) return 0
  var id = Number(ws.id)
  if (id >= 1 && id <= 10) return id
  if (/^[1-9]$|^10$/.test(name)) return parseInt(name, 10)
  return 0
}

function clientWorkspaceN(client) {
  if (!client) return 0
  return numberedWorkspaceId(client.workspace)
}

function monitorName(client, workspaces) {
  if (client && client.monitorName) return safeMonitor(client.monitorName)
  if (client && typeof client.monitor === "string" && client.monitor !== "") return safeMonitor(client.monitor)
  var n = clientWorkspaceN(client)
  var list = workspaces || []
  var i
  for (i = 0; i < list.length && i < MAX_STAGE_WORKSPACES_VALUE; i++) {
    if (numberedWorkspaceId(list[i]) === n && list[i].monitor) return safeMonitor(list[i].monitor)
  }
  if (!client || client.monitor == null || client.monitor === "") return ""
  return safeMonitor(client.monitor)
}

function pickLastWorkspace(workspaces, occupied, layout) {
  var i
  if (isArray(layout)) {
    for (i = 0; i < layout.length; i++) {
      if (layout[i] && layout[i].focused && layout[i].n >= 1 && layout[i].n <= 10) return layout[i].n
    }
  }
  for (i = 0; i < workspaces.length; i++) {
    var ws = workspaces[i]
    if (!(ws && (ws.focused || ws.active || ws.currentlyActive))) continue
    var focused = numberedWorkspaceId(ws)
    if (focused) return focused
  }
  if (occupied && occupied.length) return occupied[0].n
  for (i = 0; i < workspaces.length; i++) {
    if (numberedWorkspaceId(workspaces[i])) return 1
  }
  return null
}

function parseLayout(monitorsJson, workspaces) {
  var mons = parseJsonArg(monitorsJson, MAX_STAGE_MONITORS_VALUE)
  var out = []
  var i
  if (mons.length) {
    for (i = 0; i < mons.length && out.length < MAX_LAYOUT_ROWS_VALUE; i++) {
      var m = mons[i]
      if (!m || m.disabled) continue
      var name = safeMonitor(m.name)
      if (!name) continue
      var n = numberedWorkspaceId(m.activeWorkspace)
      if (!n && m.activeWorkspace && m.activeWorkspace.id >= 1 && m.activeWorkspace.id <= 10) {
        n = Number(m.activeWorkspace.id)
      }
      if (!n) continue
      out.push({ n: n, monitor: name, focused: !!m.focused })
    }
    return out
  }
  return out
}

function parseMonitorSizes(monitorsJson) {
  var mons = parseJsonArg(monitorsJson, MAX_STAGE_MONITORS_VALUE)
  var out = {}
  var i
  for (i = 0; i < mons.length && i < MAX_STAGE_MONITORS_VALUE; i++) {
    var m = mons[i]
    if (!m || m.disabled) continue
    var name = safeMonitor(m.name)
    if (!name) continue
    var size = monitorPixelSize(m)
    if (!size) continue
    out[name] = size
  }
  return out
}

function monitorPixelSize(m) {
  if (!m) return null
  var w = Number(m.width)
  var h = Number(m.height)
  if (!(w > 0 && h > 0) && isArray(m.size) && m.size.length >= 2) {
    w = Number(m.size[0])
    h = Number(m.size[1])
  }
  if (!(w > 0 && h > 0) || !isFinite(w) || !isFinite(h) ||
      w > MAX_NUMERIC_MAGNITUDE_VALUE || h > MAX_NUMERIC_MAGNITUDE_VALUE) return null
  var t = Number(m.transform)
  if (t === 1 || t === 3 || t === 90 || t === 270) {
    var tmp = w
    w = h
    h = tmp
  }
  return { w: w, h: h }
}

function aspectForMonitor(name, sizes) {
  var row = null
  if (sizes && name && sizes[name]) row = sizes[name]
  if (!row && sizes) {
    var k
    for (k in sizes) {
      if (Object.prototype.hasOwnProperty.call(sizes, k) && sizes[k] && sizes[k].w > 0 && sizes[k].h > 0) {
        row = sizes[k]
        break
      }
    }
  }
  if (row && row.w > 0 && row.h > 0) return row.w / row.h
  return 16 / 9
}

function connectedMonitorNames(monitorsJson, workspaces) {
  var mons = parseJsonArg(monitorsJson, MAX_STAGE_MONITORS_VALUE)
  var out = []
  var seen = {}
  var i
  if (mons.length) {
    for (i = 0; i < mons.length && out.length < MAX_STAGE_MONITORS_VALUE; i++) {
      if (!mons[i] || mons[i].disabled) continue
      var name = safeMonitor(mons[i].name)
      if (!name || seen[name]) continue
      seen[name] = true
      out.push(name)
    }
    return out
  }
  var list = isArray(workspaces) ? workspaces : parseJsonArg(workspaces, MAX_STAGE_WORKSPACES_VALUE)
  for (i = 0; i < list.length && i < MAX_STAGE_WORKSPACES_VALUE && out.length < MAX_STAGE_MONITORS_VALUE; i++) {
    var mon = safeMonitor(list[i] && list[i].monitor)
    if (!mon || seen[mon]) continue
    seen[mon] = true
    out.push(mon)
  }
  return out
}

function monitorForWorkspace(n, layout, windows, workspaces) {
  var i
  if (isArray(layout)) {
    for (i = 0; i < layout.length; i++) {
      if (layout[i] && Number(layout[i].n) === Number(n) && layout[i].monitor) return safeMonitor(layout[i].monitor)
    }
  }
  if (windows && windows[0] && windows[0].monitor) return safeMonitor(windows[0].monitor)
  var list = isArray(workspaces) ? workspaces : []
  for (i = 0; i < list.length && i < MAX_STAGE_WORKSPACES_VALUE; i++) {
    if (numberedWorkspaceId(list[i]) === Number(n) && list[i].monitor) return safeMonitor(list[i].monitor)
  }
  return ""
}

function windowSelector(address) {
  var a = boundedToken(address, MAX_ADDRESS_CHARS_VALUE)
  if (a.indexOf("address:") === 0) a = a.slice(8)
  a = boundedToken(a, MAX_ADDRESS_CHARS_VALUE)
  if (!a) return ""
  return "address:" + a
}

function stripAddress(address) {
  var a = boundedToken(address, MAX_ADDRESS_CHARS_VALUE)
  if (a.indexOf("address:") === 0) return a.slice(8)
  return a
}

function joinBatch(dispatches) {
  if (!dispatches || !dispatches.length) return ""
  var parts = []
  var i
  for (i = 0; i < dispatches.length && parts.length < MAX_STAGE_CLIENTS_VALUE + MAX_LAYOUT_ROWS_VALUE; i++) {
    parts.push("dispatch " + dispatches[i])
  }
  return parts.join("; ")
}

function stageWindows(stage) {
  if (!stage) return []
  if (isArray(stage.windows) && stage.windows.length) return stage.windows.slice(0, MAX_STAGE_CLIENTS_VALUE)
  var out = []
  var wss = stage.workspaces || []
  var i
  var j
  for (i = 0; i < wss.length && i < MAX_STAGE_WORKSPACES_VALUE && out.length < MAX_STAGE_CLIENTS_VALUE; i++) {
    var n = Number(wss[i] && wss[i].n)
    var wins = (wss[i] && wss[i].windows) || []
    for (j = 0; j < wins.length && out.length < MAX_STAGE_CLIENTS_VALUE; j++) {
      var w = wins[j] || {}
      out.push(copyGeom({
        address: w.address,
        class: w.class,
        initialClass: w.initialClass,
        title: w.title,
        floating: w.floating,
        monitor: w.monitor,
        workspace: w.workspace != null ? w.workspace : n
      }, w))
    }
  }
  return out
}

function lastClassSegment(cls) {
  var parts = boundedText(cls, MAX_COMPOSITOR_TEXT_CHARS_VALUE, "").split(".")
  return parts[parts.length - 1] || ""
}

function prettyApp(win) {
  var cls = boundedText((win && (win.class || win.initialClass)), MAX_COMPOSITOR_TEXT_CHARS_VALUE, "")
  var full = cls.toLowerCase()
  if (full.indexOf("geforce") >= 0) return "GeForce NOW"
  if (full.indexOf("chrome-") === 0) {
    var host = String(cls.slice(7).split("__")[0] || "").replace(/\/$/, "")
    if (host) return host
  }
  var last = lastClassSegment(cls)
  var lower = last.toLowerCase()
  if (lower === "zed") return "Zed"
  if (lower === "ghostty") return "Ghostty"
  if (lower === "chromium" || lower === "chrome" || lower === "google-chrome") return "Chromium"
  if (lower === "nautilus") return "Files"
  if (last === "") return "app"
  return last
}

function iconLetters(win) {
  var name = prettyApp(win)
  if (win && typeof win === "object" && win.letters) {
    return boundedText(win.letters, 4, "?")
  }
  var raw = boundedText(name, MAX_COMPOSITOR_TEXT_CHARS_VALUE, "").replace(/^\s+|\s+$/g, "")
  if (!raw || raw === "app") {
    var cls = boundedText((win && (win.class || win.initialClass)) || (typeof win === "string" ? win : ""), MAX_COMPOSITOR_TEXT_CHARS_VALUE, "")
    raw = lastClassSegment(cls) || cls
  }
  raw = String(raw || "").replace(/^\s+|\s+$/g, "")
  if (!raw) return "?"
  var parts = raw.split(/[\s._-]+/)
  var words = []
  var skip = { www: 1, com: 1, org: 1, net: 1, io: 1, app: 1, dev: 1, edu: 1, gov: 1, co: 1, uk: 1, us: 1 }
  var i
  for (i = 0; i < parts.length; i++) {
    var token = String(parts[i] || "")
    if (!token) continue
    if (skip[token.toLowerCase()] && parts.length > 1) continue
    words.push(token)
  }
  if (!words.length) words = [raw]
  if (words.length >= 2) {
    return words[0].charAt(0).toUpperCase() + words[1].charAt(0).toUpperCase()
  }
  var word = words[0]
  var first = word.charAt(0).toUpperCase()
  if (word.length === 1) return first
  return first + word.charAt(word.length - 1).toLowerCase()
}

function shortTitle(win) {
  var title = boundedText((win && win.title), MAX_COMPOSITOR_TEXT_CHARS_VALUE, "").replace(/^\s+|\s+$/g, "")
  if (!title) return ""
  var cut = title.indexOf(" - ")
  if (cut > 0 && cut <= 24) title = title.slice(0, cut)
  if (title.length > 28) title = title.slice(0, 27) + "…"
  return title
}

function tileLabel(ws) {
  if (!ws || !ws.windows || !ws.windows.length) return "empty"
  var names = []
  var seen = {}
  var i
  for (i = 0; i < ws.windows.length && i < MAX_RENDERED_PANES_PER_TILE_VALUE; i++) {
    var app = prettyApp(ws.windows[i])
    if (!app || seen[app]) continue
    seen[app] = true
    names.push(app)
  }
  if (!names.length) return "app"
  if (names.length === 1) {
    var title = shortTitle(ws.windows[0])
    if (title && title.toLowerCase().indexOf(names[0].toLowerCase()) !== 0)
      return names[0] + " · " + title
    if (title) return title
    return names[0]
  }
  var extra = ws.windows.length - names.length
  var label = names.slice(0, 3).join(" · ")
  if (names.length > 3) label += " · +" + (names.length - 3)
  else if (extra > 0) label += " · +" + extra
  return boundedText(label, MAX_COMPOSITOR_TEXT_CHARS_VALUE, "")
}

function workspaceTileN(ws, cap) {
  var n = Number(ws && ws.n)
  if (n >= 1 && n <= cap) return n
  n = Number(ws && ws.workspace)
  if (n >= 1 && n <= cap) return n
  n = numberedWorkspaceId(ws)
  if (n >= 1 && n <= cap) return n
  return 0
}

// One tile per workspace 1..highest in use, always in numeric order, so a workspace keeps
// its slot whether or not it has windows.
function workspaceTiles(stage, limit) {
  var cap = Number(limit)
  if (!isFinite(cap) || cap < 1) cap = 10
  if (cap > 10) cap = 10
  var list = stage && isArray(stage.workspaces) ? stage.workspaces.slice(0, MAX_STAGE_WORKSPACES_VALUE) : []
  var sizes = (stage && stage.monitorSizes) || {}
  var meta = (stage && stage.layoutMeta) || {}
  var byN = {}
  var i
  var n
  for (i = 0; i < list.length; i++) {
    n = workspaceTileN(list[i], cap)
    if (n && !byN[n] && list[i] && isArray(list[i].windows) && list[i].windows.length) byN[n] = list[i]
  }
  // Show 1..highest workspace in use, so gaps stay in place but nothing trails
  // after the last busy one. The focused workspace counts as in use.
  var top = 1
  for (n = 1; n <= cap; n++) if (byN[n]) top = n
  var focused = stage && stage.lastWorkspace != null ? Number(stage.lastWorkspace) : 0
  if (focused >= 1 && focused <= cap && focused > top) top = Math.floor(focused)
  var tiles = []
  for (n = 1; n <= top; n++) {
    var ws = byN[n]
    if (!ws) {
      var known = meta[n] || {}
      tiles.push({
        n: n,
        label: "Empty",
        vacant: true,
        panes: [],
        under: [],
        aspect: aspectForMonitor("", sizes),
        hyprId: hasHyprWorkspaceId(known.hyprId) ? known.hyprId : null,
        tiledLayout: normalizeTiledLayout(known.tiledLayout)
      })
      continue
    }
    var wins = ws.windows
    var layout = paneLayout(wins)
    tiles.push({
      n: n,
      label: tileLabel(ws),
      vacant: false,
      panes: layout.panes,
      under: layout.under,
      aspect: aspectForMonitor(ws.monitor, sizes),
      hyprId: ws.hyprId || (wins[0] && wins[0].hyprId),
      tiledLayout: normalizeTiledLayout(ws.tiledLayout || (wins[0] && wins[0].tiledLayout))
    })
  }
  return tiles
}

// Keeps the tiles whose number or label matches the query, in numeric order.
function filterTiles(tiles, query) {
  var q = normalizeQuery(query)
  var list = isArray(tiles) ? tiles : []
  if (q === "") return list.slice()
  var out = []
  var i
  for (i = 0; i < list.length; i++) {
    var tile = list[i]
    if (!tile) continue
    var score = Math.max(scoreText(q, tile.vacant ? "" : tile.label), scoreText(q, String(tile.n)))
    if (score > 0) out.push(tile)
  }
  return out
}

function windowGeom(win) {
  if (!win) return null
  var x = win.x
  var y = win.y
  var w = win.w
  var h = win.h
  if ((x == null || !isFinite(Number(x))) && isArray(win.at) && win.at.length >= 2) {
    x = win.at[0]
    y = win.at[1]
  }
  if ((w == null || !isFinite(Number(w))) && isArray(win.size) && win.size.length >= 2) {
    w = win.size[0]
    h = win.size[1]
  }
  x = Number(x)
  y = Number(y)
  w = Number(w)
  h = Number(h)
  if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h) || w < 1 || h < 1) return null
  if (Math.abs(x) > MAX_NUMERIC_MAGNITUDE_VALUE || Math.abs(y) > MAX_NUMERIC_MAGNITUDE_VALUE ||
      w > MAX_NUMERIC_MAGNITUDE_VALUE || h > MAX_NUMERIC_MAGNITUDE_VALUE) return null
  return { x: x, y: y, w: w, h: h }
}

function windowPanes(windows) {
  return paneLayout(windows).panes
}

function windowsUnder(windows) {
  return paneLayout(windows).under
}

function paneLayout(windows) {
  var all = isArray(windows) ? windows.slice(0, MAX_STAGE_CLIENTS_VALUE) : []
  var list = all.slice(0, MAX_RENDERED_PANES_PER_TILE_VALUE)
  var empty = { panes: [], under: [] }
  var geoms = []
  var i
  var minX = Infinity
  var minY = Infinity
  var maxX = -Infinity
  var maxY = -Infinity
  for (i = 0; i < list.length; i++) {
    var g = windowGeom(list[i])
    if (!g) continue
    geoms.push({ win: list[i], x: g.x, y: g.y, w: g.w, h: g.h })
    if (g.x < minX) minX = g.x
    if (g.y < minY) minY = g.y
    if (g.x + g.w > maxX) maxX = g.x + g.w
    if (g.y + g.h > maxY) maxY = g.y + g.h
  }
  var bw = maxX - minX
  var bh = maxY - minY
  var panes = []
  var top = coveringWindow(all, geoms, bw, bh)
  if (!top) top = coveringWindow(all, [])
  if (top) {
    return { panes: [paneRecord(top, 0, 0, 1, 1)], under: underRecords(all, top) }
  }
  if (!geoms.length || !(bw > 0) || !(bh > 0)) {
    var n = list.length
    if (!n) return empty
    for (i = 0; i < n; i++) {
      panes.push(paneRecord(list[i], i / n, 0, 1 / n, 1))
    }
    return { panes: panes, under: [] }
  }
  for (i = 0; i < geoms.length; i++) {
    panes.push(paneRecord(
      geoms[i].win,
      (geoms[i].x - minX) / bw,
      (geoms[i].y - minY) / bh,
      geoms[i].w / bw,
      geoms[i].h / bh
    ))
  }
  return { panes: panes, under: [] }
}

function underRecords(list, top) {
  var out = []
  if (!isArray(list) || !top) return out
  var topAddr = top.address ? stripAddress(top.address) : ""
  var i
  for (i = 0; i < list.length && out.length < MAX_RENDERED_PANES_PER_TILE_VALUE; i++) {
    var win = list[i]
    if (!win || win === top) continue
    if (topAddr && win.address && stripAddress(win.address) === topAddr) continue
    out.push({
      icon: iconName(win),
      class: boundedText((win.class || win.initialClass), MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
      letters: iconLetters(win)
    })
  }
  return out
}

function isFullscreenWin(win) {
  if (!win) return false
  if (win.fullscreen === true) return true
  var n = Number(win.fullscreen)
  return isFinite(n) && n > 0
}

function coveringWindow(list, geoms, bw, bh) {
  var i
  var flagged = null
  if (isArray(list)) {
    for (i = 0; i < list.length; i++) {
      if (isFullscreenWin(list[i])) flagged = list[i]
    }
  }
  if (flagged) return flagged
  if (!isArray(geoms) || geoms.length < 2 || !(bw > 0) || !(bh > 0)) return null
  var best = null
  var bestArea = 0
  for (i = 0; i < geoms.length; i++) {
    if (geoms[i].w / bw < 0.92 || geoms[i].h / bh < 0.92) continue
    var area = geoms[i].w * geoms[i].h
    if (area > bestArea) {
      best = geoms[i].win
      bestArea = area
    }
  }
  return best
}

function paneRecord(win, x, y, w, h) {
  return {
    x: x,
    y: y,
    w: w,
    h: h,
    icon: iconName(win),
    class: boundedText((win && (win.class || win.initialClass)), MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
    letters: iconLetters(win),
    floating: !!(win && win.floating),
    address: win && win.address ? boundedToken(stripAddress(win.address), MAX_ADDRESS_CHARS_VALUE) : ""
  }
}

function copyGeom(dst, src) {
  if (!dst) dst = {}
  if (!src) return dst
  var g = windowGeom(src)
  if (g) {
    dst.x = g.x
    dst.y = g.y
    dst.w = g.w
    dst.h = g.h
  }
  var pid = src.pid != null ? Number(src.pid) : NaN
  if (isFinite(pid) && pid > 0) dst.pid = pid
  if (src.fullscreen === true) dst.fullscreen = 2
  else {
    var fs = Number(src.fullscreen)
    if (isFinite(fs) && fs > 0) dst.fullscreen = fs
  }
  return dst
}
