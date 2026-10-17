#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const vm = require("vm")
const assert = require("assert")

const source = fs.readFileSync(path.join(__dirname, "..", "Model.js"), "utf8")
const model = {}
vm.createContext(model)
vm.runInContext(source, model)

const clientsText = fs.readFileSync(path.join(__dirname, "fixtures", "clients.json"), "utf8")
const workspacesText = fs.readFileSync(path.join(__dirname, "fixtures", "workspaces.json"), "utf8")
const clients = JSON.parse(clientsText)
const workspaces = JSON.parse(workspacesText)

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function same(actual, expected) {
  assert.deepStrictEqual(clone(actual), expected)
}

var tests = 0
function test(name, fn) {
  fn()
  tests += 1
}

test("2 parseStage drops scratchpad and every other special workspace", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  const addrs = stage.windows.map((w) => w.address)
  assert.ok(addrs.indexOf("0x55f11fe15110") >= 0)
  assert.ok(addrs.indexOf("0x55f11fe15220") >= 0)
  assert.ok(addrs.indexOf("0x55f11fe15330") >= 0)
  assert.ok(addrs.indexOf("0x55f11fe15aaa") === -1)
  assert.ok(addrs.indexOf("0x55f11fe15bbb") === -1)
  assert.ok(addrs.indexOf("0x55f11fe15ccc") === -1)
  stage.windows.forEach((w) => {
    assert.ok(w.workspace >= 1 && w.workspace <= 10)
  })
  const blob = JSON.stringify(stage)
  assert.ok(blob.indexOf("scratchpad") === -1)
  assert.ok(blob.indexOf("omadesk-") === -1)
  assert.strictEqual(stage.lastWorkspace, 3)
  assert.strictEqual(stage.windows.length, 3)
  assert.strictEqual(stage.windows[0].monitor, "DP-1")
  const parsedAgain = model.parseStage(clients, workspaces)
  assert.strictEqual(parsedAgain.windows.length, 3)
})

test("18 cursor h/j/k/l and jump to a workspace number", function() {
  assert.strictEqual(model.moveCursor(1, "h", 4, 2), 0)
  assert.strictEqual(model.moveCursor(0, "l", 4, 2), 1)
  assert.strictEqual(model.moveCursor(0, "j", 4, 2), 2)
  assert.strictEqual(model.moveCursor(2, "k", 4, 2), 0)
  assert.strictEqual(model.moveCursor(0, "left", 4), 0)
  assert.strictEqual(model.moveCursor(0, "right", 4), 1)
  assert.strictEqual(model.moveCursor(3, "down", 4, 2), 3)
  assert.strictEqual(model.moveCursor(1, "up", 4, 2), 0)
  assert.strictEqual(model.moveCursor(9, "l", 0, 2), 0)
  const tiles = [{ n: 1 }, { n: 2 }, { n: 5 }, { n: 7, vacant: true }]
  assert.strictEqual(model.tileIndexForN(tiles, 1, 3), 0)
  assert.strictEqual(model.tileIndexForN(tiles, 5, 0), 2)
  assert.strictEqual(model.tileIndexForN(tiles, 7, 0), 3)
  assert.strictEqual(model.tileIndexForN(tiles, 4, 2), 2)
  assert.strictEqual(model.tileIndexForN([], 4, 2), 2)
  assert.strictEqual(model.tileIndexForN(tiles, 4, -1), 0)
})

test("24 pretty names still read well for desktop ids and PWA classes", function() {
  assert.strictEqual(model.prettyApp({ class: "chrome-x.com__-Profile_1" }), "x.com")
  assert.strictEqual(model.prettyApp({ class: "GeForceNOW" }), "GeForce NOW")
  assert.strictEqual(model.prettyApp({ class: "dev.zed.Zed" }), "Zed")
  assert.strictEqual(model.prettyApp({ class: "org.gnome.Nautilus" }), "Files")
})

test("26 tiles run 1..highest workspace in use in numeric order, gaps are vacant", function() {
  const live = {
    workspaces: [
      { n: 3, windows: [{ class: "chromium", title: "draft" }] },
      { n: 1, windows: [{ class: "dev.zed.Zed", title: "charcana" }] },
      { n: 7, windows: [{ class: "com.mitchellh.ghostty", title: "x" }] }
    ]
  }
  const tiles = model.workspaceTiles(live)
  assert.strictEqual(tiles.length, 7)
  same(tiles.map((t) => t.n), [1, 2, 3, 4, 5, 6, 7])
  same(tiles.map((t) => t.vacant), [false, true, false, true, true, true, false])
  assert.strictEqual(tiles[0].label, "Zed · charcana")
  assert.strictEqual(tiles[1].label, "Empty")
  assert.strictEqual(tiles[1].panes.length, 0)
  // A smaller limit trims the slots; a bad one falls back to ten.
  assert.strictEqual(model.workspaceTiles(live, 4).length, 3)
  assert.strictEqual(model.workspaceTiles(live, 99).length, 7)
  assert.strictEqual(model.workspaceTiles(live, "x").length, 7)
  // Workspace 10 in use shows all ten; the focused workspace counts as in use.
  const far = { workspaces: [{ n: 10, windows: [{ class: "chromium", title: "x" }] }] }
  assert.strictEqual(model.workspaceTiles(far).length, 10)
  assert.strictEqual(model.workspaceTiles({ workspaces: live.workspaces, lastWorkspace: 9 }).length, 9)
  assert.strictEqual(model.workspaceTiles({ workspaces: live.workspaces, lastWorkspace: 2 }).length, 7)
  // Moving windows around never moves a workspace's slot.
  const moved = { workspaces: [{ n: 2, windows: [{ class: "chromium", title: "draft" }] }] }
  same(model.workspaceTiles(moved).map((t) => t.n), [1, 2])
  const many = {
    workspaces: [{
      n: 2,
      windows: [
        { class: "com.mitchellh.ghostty", title: "one" },
        { class: "chromium", title: "two" },
        { class: "com.mitchellh.ghostty", title: "three" }
      ]
    }]
  }
  const stacked = model.workspaceTiles(many)[1]
  assert.strictEqual(stacked.n, 2)
  assert.ok(stacked.label.indexOf("Ghostty") >= 0)
  assert.ok(stacked.label.indexOf("Chromium") >= 0)
})

test("32 dispatch quoting rejects quotes and newlines", function() {
  assert.strictEqual(model.moveDispatch("1", '0x"evil'), "")
  assert.strictEqual(model.moveDispatch("1", "0x\nABC"), "")
  assert.strictEqual(model.moveDispatch('ws"x', "0xABC"), "")
  assert.strictEqual(model.focusDispatch('3"'), "")
  assert.strictEqual(model.safeMonitor('DP-"1'), "")
  assert.strictEqual(model.safeMonitor("HDMI-A-1\n"), "")
  const stage = {
    windows: [{ address: '0x"bad', workspace: 1, class: "foot" }],
    workspaces: [{ n: 1, windows: [{ address: '0x"bad', class: "foot" }] }]
  }
  same(model.swapWorkspacePlan(stage, 1, 2).dispatches, [])
  assert.strictEqual(
    model.moveDispatch("2", "0xABC"),
    'hl.dsp.window.move({ workspace = "2", follow = false, window = "address:0xABC" })'
  )
})

test("34 empty and invalid parseStage yield an empty stage", function() {
  const empty = model.parseStage("", "")
  same(empty.windows, [])
  same(empty.workspaces, [])
  const bad = model.parseStage("{", "not-json")
  same(bad.windows, [])
  assert.strictEqual(bad.valid, false)
  assert.strictEqual(model.parseStage("{}", "[]", "[]").valid, false)
})

test("38 disabled monitors are omitted from layout and connected names", function() {
  const monitors = [
    { name: "DP-1", focused: true, disabled: false, activeWorkspace: { id: 1, name: "1" } },
    { name: "HDMI-A-1", focused: false, disabled: true, activeWorkspace: { id: 4, name: "4" } }
  ]
  const stage = model.parseStage(clientsText, workspacesText, JSON.stringify(monitors))
  assert.ok(stage.monitors.indexOf("DP-1") >= 0)
  assert.ok(stage.monitors.indexOf("HDMI-A-1") === -1)
  stage.layout.forEach((row) => {
    assert.ok(row.monitor !== "HDMI-A-1")
  })
})

test("47 pane layout follows dwindle and scrolling geometry; icons not names", function() {
  const scroll = model.paneLayout([
    { class: "foot", at: [0, 0], size: [400, 800] },
    { class: "chromium", at: [400, 0], size: [400, 800] }
  ]).panes
  assert.strictEqual(scroll.length, 2)
  assert.ok(Math.abs(scroll[0].x - 0) < 1e-9)
  assert.ok(Math.abs(scroll[0].w - 0.5) < 1e-9)
  assert.ok(Math.abs(scroll[1].x - 0.5) < 1e-9)
  assert.ok(Math.abs(scroll[1].w - 0.5) < 1e-9)
  assert.strictEqual(scroll[0].icon, "foot")
  assert.strictEqual(scroll[1].icon, "chromium")
  const dwindle = model.paneLayout([
    { class: "dev.zed.Zed", x: 0, y: 0, w: 800, h: 400 },
    { class: "com.mitchellh.ghostty", x: 0, y: 400, w: 800, h: 400 }
  ]).panes
  assert.strictEqual(dwindle.length, 2)
  assert.ok(Math.abs(dwindle[0].h - 0.5) < 1e-9)
  assert.ok(Math.abs(dwindle[1].y - 0.5) < 1e-9)
  assert.strictEqual(dwindle[0].icon, "zed")
  assert.strictEqual(dwindle[1].icon, "com.mitchellh.ghostty")
  const stage = model.parseStage(clientsText, workspacesText)
  assert.ok(stage.windows[0].w > 0)
  const tiles = model.workspaceTiles(stage)
  assert.ok(tiles[0].panes.length >= 1)
  assert.ok(tiles[0].panes[0].icon)
  assert.strictEqual(model.iconName({ class: "dev.zed.Zed" }), "zed")
  assert.strictEqual(model.iconName({ class: "chrome-music.apple.com__-Profile_1" }), "chromium")
  // Geometry and icons come off the live stage, which is the only source now.
  const zed = stage.workspaces[0].windows[0]
  assert.ok(zed.w > 0)
  assert.ok(model.iconName(zed))
  const covered = model.paneLayout([
    { class: "foot", x: 0, y: 0, w: 400, h: 400 },
    { class: "com.mitchellh.ghostty", x: 0, y: 400, w: 400, h: 400 },
    { class: "chromium", x: 0, y: 0, w: 800, h: 800, fullscreen: 2 }
  ]).panes
  assert.strictEqual(covered.length, 1)
  assert.strictEqual(covered[0].icon, "chromium")
  assert.ok(Math.abs(covered[0].w - 1) < 1e-9)
  assert.ok(Math.abs(covered[0].h - 1) < 1e-9)
  const maximized = model.paneLayout([
    { class: "foot", x: 12, y: 50, w: 400, h: 500 },
    { class: "chromium", x: 0, y: 0, w: 1920, h: 1080 }
  ]).panes
  assert.strictEqual(maximized.length, 1)
  assert.strictEqual(maximized[0].icon, "chromium")
  const stacked = [
    { class: "foot", x: 0, y: 0, w: 400, h: 400, address: "0xa" },
    { class: "com.mitchellh.ghostty", x: 0, y: 400, w: 400, h: 400, address: "0xb" },
    { class: "chromium", x: 0, y: 0, w: 800, h: 800, fullscreen: 2, address: "0xc" }
  ]
  const under = model.paneLayout(stacked).under
  assert.strictEqual(under.length, 2)
  assert.strictEqual(under[0].icon, "foot")
  assert.strictEqual(under[1].icon, "com.mitchellh.ghostty")
  const tile = model.workspaceTiles({ workspaces: [{ n: 1, windows: stacked }] })[0]
  assert.strictEqual(tile.panes.length, 1)
  assert.strictEqual(tile.panes[0].icon, "chromium")
  assert.strictEqual(tile.under.length, 2)
  same(model.paneLayout([
    { class: "foot", x: 0, y: 0, w: 400, h: 800 },
    { class: "chromium", x: 400, y: 0, w: 400, h: 800 }
  ]).under, [])
})

test("49 iconLetters: one word first+last, two words initials", function() {
  assert.strictEqual(model.iconLetters({ class: "firefox" }), "Fx")
  assert.strictEqual(model.iconLetters({ class: "org.mozilla.firefox" }), "Fx")
  assert.strictEqual(model.iconLetters({ class: "chromium" }), "Cm")
  assert.strictEqual(model.iconLetters({ class: "dev.zed.Zed" }), "Zd")
  assert.strictEqual(model.iconLetters({ class: "com.mitchellh.ghostty" }), "Gy")
  assert.strictEqual(model.iconLetters({ class: "GeForceNOW" }), "GN")
  assert.strictEqual(model.iconLetters({ class: "chrome-music.apple.com__-Profile_1" }), "MA")
  assert.strictEqual(model.iconLetters({ class: "X" }), "X")
})

test("50 minimap aspect matches the monitor", function() {
  const monitors = [
    { name: "DP-1", width: 2560, height: 1440, disabled: false, focused: true, activeWorkspace: { id: 1, name: "1" } },
    { name: "HDMI-A-1", width: 3440, height: 1440, disabled: false, focused: false, activeWorkspace: { id: 4, name: "4" } }
  ]
  const stage = model.parseStage(clientsText, workspacesText, JSON.stringify(monitors))
  assert.ok(Math.abs(stage.monitorSizes["DP-1"].w / stage.monitorSizes["DP-1"].h - 2560 / 1440) < 1e-9)
  const tiles = model.workspaceTiles(stage)
  assert.ok(Math.abs(tiles[0].aspect - 2560 / 1440) < 1e-9)
  const portrait = model.parseMonitorSizes(JSON.stringify([
    { name: "eDP-1", width: 1920, height: 1080, transform: 1, disabled: false }
  ]))
  assert.strictEqual(portrait["eDP-1"].w, 1080)
  assert.strictEqual(portrait["eDP-1"].h, 1920)
  assert.ok(Math.abs(model.aspectForMonitor("eDP-1", portrait) - 1080 / 1920) < 1e-9)
})

test("51 focusWorkspaceN only accepts workspaces 1-10", function() {
  assert.strictEqual(model.focusWorkspaceN(7), 7)
  assert.strictEqual(model.focusWorkspaceN("10"), 10)
  assert.strictEqual(model.focusWorkspaceN(0), null)
  assert.strictEqual(model.focusWorkspaceN("null"), null)
})

test("52 live tiles use n not id, and an unseen workspace is vacant", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  const tiles = model.workspaceTiles(stage)
  assert.ok(tiles.length >= 3 && tiles.length <= 10)
  tiles.forEach((t) => {
    assert.ok(t.n >= 1 && t.n <= 10)
    assert.strictEqual(t.id, undefined)
  })
  assert.ok(tiles.slice(0, 3).every((t) => !t.vacant))
  assert.strictEqual(model.workspaceTiles({}).length, 1)
  assert.ok(model.workspaceTiles({}).every((t) => t.vacant))
  const bogus = model.workspaceTiles({ workspaces: [{ n: 1, windows: 2 }, { n: 8, windows: 0 }] })
  assert.ok(bogus.every((t) => t.vacant))
  // A vacant tile still carries the layout Hyprland reports for that workspace.
  const withMeta = model.workspaceTiles({ workspaces: [], lastWorkspace: 5, layoutMeta: { 4: { hyprId: 4, tiledLayout: "scrolling" } } })
  assert.strictEqual(withMeta[3].tiledLayout, "scrolling")
  assert.strictEqual(withMeta[3].hyprId, 4)
  assert.strictEqual(withMeta[4].tiledLayout, "dwindle")
  assert.strictEqual(withMeta[4].hyprId, null)
})

test("59 workspace tiledLayout toggle uses Omarchy ids and lua rules", function() {
  assert.strictEqual(model.normalizeTiledLayout("scrolling"), "scrolling")
  assert.strictEqual(model.normalizeTiledLayout("Scroll"), "scrolling")
  assert.strictEqual(model.normalizeTiledLayout(""), "dwindle")
  assert.strictEqual(model.normalizeTiledLayout("master"), "dwindle")
  assert.strictEqual(model.nextTiledLayout("dwindle"), "scrolling")
  assert.strictEqual(model.nextTiledLayout("scrolling"), "dwindle")
  assert.strictEqual(model.hasHyprWorkspaceId(1), true)
  assert.strictEqual(model.hasHyprWorkspaceId(-83), true)
  assert.strictEqual(model.hasHyprWorkspaceId(0), false)
  assert.strictEqual(model.hasHyprWorkspaceId(null), false)
  assert.strictEqual(
    model.workspaceLayoutRuleLua(3, "scrolling"),
    'hl.workspace_rule({ workspace = "3", layout = "scrolling" })\n'
  )
  // Numbered workspaces use the same bare selector Omarchy's Super+L writes, so
  // omadesk and Super+L keep a single rule per workspace instead of two that
  // shadow each other.
  assert.strictEqual(model.workspaceLayoutSelector(1), "1")
  assert.strictEqual(model.workspaceLayoutSelector("1"), "1")
  assert.strictEqual(model.workspaceLayoutSelector(10), "10")
  // A bare negative id is a relative selector in Hyprland and resolves to
  // workspace 1, so it must never reach a rule.
  assert.strictEqual(model.workspaceLayoutSelector("-83"), "")
  assert.strictEqual(model.workspaceLayoutSelector(-98), "")
  assert.strictEqual(model.workspaceLayoutRuleLua("-83", "dwindle"), "")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 3, hyprId: 3 }), "3")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 5, hyprId: 5 }), "5")
  // A negative id is a relative selector in Hyprland, so the plain number wins.
  assert.strictEqual(model.workspaceLayoutTarget({ n: 1, hyprId: -83 }), "1")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 1 }), "1")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 4, vacant: true }), "4")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 0 }), "")
  assert.strictEqual(model.workspaceLayoutPersistId("3"), "3")
  assert.strictEqual(model.workspaceLayoutPersistId("-83"), "")
  assert.strictEqual(
    model.workspaceLayoutsDir("/home/ada", ""),
    "/home/ada/.local/state/omarchy/workspace-layouts"
  )
  assert.strictEqual(
    model.workspaceLayoutsDir("/home/ada", "/tmp/state"),
    "/tmp/state/omarchy/workspace-layouts"
  )
  const withLayouts = workspaces.map(function(ws) {
    const row = clone(ws)
    if (row.id === 1) row.tiledLayout = "scrolling"
    return row
  })
  const stage = model.parseStage(clientsText, JSON.stringify(withLayouts))
  const ws1 = stage.workspaces.filter((w) => w.n === 1)[0]
  assert.strictEqual(ws1.tiledLayout, "scrolling")
  assert.strictEqual(ws1.hyprId, 1)
  const liveTiles = model.workspaceTiles(stage)
  assert.strictEqual(liveTiles[0].tiledLayout, "scrolling")
  assert.strictEqual(liveTiles[0].hyprId, 1)
  assert.strictEqual(liveTiles[1].tiledLayout, "dwindle")
})

test("60 pane move goes to a numbered workspace, never to the one it is on", function() {
  const addr = "0x55f11fe15110"
  assert.strictEqual(
    model.windowMoveDispatch(addr, 1, 3),
    'hl.dsp.window.move({ workspace = "3", follow = false, window = "address:0x55f11fe15110" })'
  )
  assert.strictEqual(model.windowMoveDispatch(addr, 2, 2), "")
  assert.strictEqual(model.windowMoveDispatch("", 1, 3), "")
  assert.strictEqual(model.windowMoveDispatch(addr, 1, 0), "")
  const panes = model.paneLayout([
    { class: "foot", address: "0xaaa", at: [0, 0], size: [400, 800] },
    { class: "chromium", address: "0xbbb", at: [400, 0], size: [400, 800] }
  ]).panes
  assert.strictEqual(panes[0].address, "0xaaa")
  assert.strictEqual(panes[1].address, "0xbbb")
})

test("61 pane move target is any empty workspace, and parseStage exposes layouts", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  assert.strictEqual(model.windowMoveDispatch("0xaaa", 1, 4).indexOf('workspace = "4"') >= 0, true)
  assert.strictEqual(model.windowMoveDispatch("0xaaa", 1, 9).indexOf('workspace = "9"') >= 0, true)
  assert.strictEqual(typeof stage.layoutMeta, "object")
  assert.strictEqual(typeof model.emptyStage().layoutMeta, "object")
})

test("63 workspace layout apply argv writes Omarchy lua then evals", function() {
  const dir = "/home/ada/.local/state/omarchy/workspace-layouts"
  const argv = model.workspaceLayoutApplyArgv(dir, 2, "scrolling")
  assert.strictEqual(argv[0], "bash")
  assert.strictEqual(argv[1], "-c")
  assert.ok(argv[2].indexOf("mkdir -p --") >= 0)
  assert.ok(argv[2].indexOf("hyprctl eval") >= 0)
  assert.ok(argv[2].indexOf("hyprctl reload config-only") >= 0)
  assert.strictEqual(argv.length, 7)
  assert.strictEqual(argv[4], dir)
  assert.strictEqual(argv[5], 'hl.workspace_rule({ workspace = "2", layout = "scrolling" })')
  assert.strictEqual(argv[6], dir + "/2.lua")

  // Toggling workspace 2 must leave workspace 1 alone: it may only write 2.lua,
  // and the single rule it evals may only name workspace 2. A rule for "1" or a
  // second selector such as "name:1" would take ownership of workspace 1's
  // layout away from 1.lua.
  const writes = argv.slice(4).filter((arg) => arg.indexOf(dir + "/") === 0)
  same(writes, [dir + "/2.lua"])
  assert.ok(argv[5].indexOf('"1"') === -1)
  assert.ok(argv[5].indexOf("name:1") === -1)
  assert.ok(argv.slice(3).join("\n").indexOf(dir + "/1.lua") === -1)

  // The cleanup glob only covers bare-negative-id files, which are the ones that
  // resolve to workspace 1. It must not sweep away sibling numbered files.
  assert.ok(argv[2].indexOf('"$1"/-*.lua') >= 0)
  assert.ok(argv[2].indexOf('"$1"/*.lua') === -1)

  const one = model.workspaceLayoutApplyArgv(dir, 1, "dwindle")
  assert.strictEqual(one[5], 'hl.workspace_rule({ workspace = "1", layout = "dwindle" })')
  assert.strictEqual(one[6], dir + "/1.lua")
  // A negative id never persists, so the loader cannot replay it as a relative
  // selector against workspace 1.
  same(model.workspaceLayoutApplyArgv(dir, "-83", "dwindle"), [])
  same(model.workspaceLayoutApplyArgv(dir, -98, "scrolling"), [])
  same(model.workspaceLayoutApplyArgv(dir, "", "scrolling"), [])
  same(model.workspaceLayoutApplyArgv("", 2, "scrolling"), [])
})

test("68 workspace drop swaps both sides, never merges them", function() {
  const clients = [
    { address: "0xa1", class: "foot", title: "a", workspace: { id: 1, name: "1" }, at: [0, 0], size: [100, 100] },
    { address: "0xa2", class: "mpv", title: "a2", workspace: { id: 1, name: "1" }, at: [0, 0], size: [100, 100] },
    { address: "0xb1", class: "chromium", title: "b", workspace: { id: 3, name: "3" }, at: [0, 0], size: [100, 100] }
  ]
  const wss = [
    { id: 1, name: "1", monitor: "DP-1", monitorID: 0 },
    { id: 3, name: "3", monitor: "DP-1", monitorID: 0 }
  ]
  const stage = model.parseStage(JSON.stringify(clients), JSON.stringify(wss))

  // Both directions are emitted, so neither side is left sharing a workspace.
  const swap = model.swapWorkspacePlan(stage, 1, 3)
  same(swap.dispatches, [
    'hl.dsp.window.move({ workspace = "3", follow = false, window = "address:0xa1" })',
    'hl.dsp.window.move({ workspace = "3", follow = false, window = "address:0xa2" })',
    'hl.dsp.window.move({ workspace = "1", follow = false, window = "address:0xb1" })'
  ])
  // Addresses are read before anything moves, so apply order cannot merge them.
  assert.strictEqual(swap.dispatches.filter((d) => d.indexOf("0xa1") >= 0).length, 1)

  // Swapping into an empty workspace still moves the occupied side across.
  same(model.swapWorkspacePlan(stage, 1, 5).dispatches, [
    'hl.dsp.window.move({ workspace = "5", follow = false, window = "address:0xa1" })',
    'hl.dsp.window.move({ workspace = "5", follow = false, window = "address:0xa2" })'
  ])

  same(model.swapWorkspacePlan(stage, 2, 2).dispatches, [])
  same(model.swapWorkspacePlan(stage, 1, 0).dispatches, [])
  same(model.swapWorkspacePlan(stage, 1, 11).dispatches, [])
})

test("70 layout apply uses Super+L workspace ids and does not pin a second rule", function() {
  assert.strictEqual(model.nextTiledLayout("dwindle"), "scrolling")
  assert.strictEqual(model.nextTiledLayout(model.nextTiledLayout("dwindle")), "dwindle")
  assert.strictEqual(model.nextTiledLayout("scrolling"), "dwindle")
  assert.strictEqual(model.nextTiledLayout(model.nextTiledLayout("scrolling")), "scrolling")

  const live = { n: 3, hyprId: 3 }
  assert.strictEqual(model.workspaceLayoutTarget(live), "3")

  const dir = "/home/ada/.local/state/omarchy/workspace-layouts"
  const first = model.workspaceLayoutApplyArgv(dir, model.workspaceLayoutTarget(live), model.nextTiledLayout("dwindle"))
  const second = model.workspaceLayoutApplyArgv(dir, model.workspaceLayoutTarget(live), model.nextTiledLayout("scrolling"))
  assert.ok(first.length)
  assert.ok(second.length)
  assert.strictEqual(first[6], dir + "/3.lua")
  assert.strictEqual(second[6], dir + "/3.lua")
  assert.strictEqual(model.workspaceLayoutPersistId("3"), "3")
  assert.ok(first[5].indexOf('workspace = "3"') >= 0)
  assert.ok(first[5].indexOf('layout = "scrolling"') >= 0)
  assert.ok(second[5].indexOf('workspace = "3"') >= 0)
  assert.ok(second[5].indexOf('layout = "dwindle"') >= 0)
  assert.ok(first[5].indexOf("special:") === -1)
  assert.ok(second[5].indexOf("special:") === -1)
  assert.notStrictEqual(first[5], second[5])

  // Each apply writes one file and evals one rule, both naming only its own
  // workspace, so toggling workspace 3 cannot reassign workspace 1's layout.
  assert.strictEqual(first.length, 7)
  assert.ok(first.slice(3).join("\n").indexOf(dir + "/1.lua") === -1)
  assert.ok(first[5].indexOf('"1"') === -1)

  assert.strictEqual(model.workspaceLayoutPersistId("-83"), "")
  assert.strictEqual(model.workspaceLayoutRuleLua("-83", "dwindle"), "")
})

test("71 pane drop dispatch survives whatever the drag source reports", function() {
  const addr = "0x55f11fe15110"
  const moveTo3 = 'hl.dsp.window.move({ workspace = "3", follow = false, window = "address:0x55f11fe15110" })'
  // Drag.source hands back a pane address that may already carry the prefix.
  assert.strictEqual(model.windowMoveDispatch("address:" + addr, 1, 3), moveTo3)
  // fromWorkspaceN is undefined until a pane knows its tile, and an unknown
  // origin must not be read as "same workspace" and swallowed.
  assert.strictEqual(model.windowMoveDispatch(addr, null, 3), moveTo3)
  assert.strictEqual(model.windowMoveDispatch(addr, undefined, 3), moveTo3)
  assert.strictEqual(model.windowMoveDispatch(addr, 1, 11), "")
  assert.strictEqual(model.windowMoveDispatch('0x"evil', 1, 3), "")
  assert.strictEqual(model.windowMoveDispatch("0x\nevil", 1, 3), "")
})

test("75 compositor parsing and rendered models have hard cardinality and string caps", function() {
  const tooManyClients = []
  for (let i = 0; i <= model.maxStageClients(); i++) {
    tooManyClients.push({
      address: "0x" + i.toString(16),
      class: "foot",
      title: "terminal",
      workspace: { id: 1, name: "1" },
      at: [i, 0],
      size: [100, 100]
    })
  }
  const rejected = model.parseStage(JSON.stringify(tooManyClients), "[]", "[]")
  assert.strictEqual(rejected.valid, false)
  same(rejected.windows, [])
  const outputLimit = model.maxCompositorOutputBytes()
  assert.strictEqual(model.parseStage(" ".repeat(outputLimit + 1), "[]", "[]").valid, false)

  const longText = "x".repeat(model.maxCompositorTextChars() * 2)
  const bounded = model.parseStage(JSON.stringify([{
    address: "0xabc",
    class: longText,
    initialClass: longText,
    title: longText,
    workspace: { id: 1, name: "1" },
    at: [0, 0],
    size: [100, 100]
  }]), JSON.stringify([{ id: 1, name: "1", monitor: "DP-1" }]), "[]")
  assert.strictEqual(bounded.valid, true)
  assert.strictEqual(bounded.windows.length, 1)
  assert.ok(bounded.windows[0].class.length <= model.maxCompositorTextChars())
  assert.ok(bounded.windows[0].initialClass.length <= model.maxCompositorTextChars())
  assert.ok(bounded.windows[0].title.length <= model.maxCompositorTextChars())

  const manyWindows = []
  for (let i = 0; i < model.maxRenderedPanesPerTile() + 10; i++) {
    manyWindows.push({
      address: "0x" + i.toString(16),
      class: "foot",
      at: [i * 10, 0],
      size: [10, 100]
    })
  }
  assert.strictEqual(model.paneLayout(manyWindows).panes.length, model.maxRenderedPanesPerTile())
  const covered = manyWindows.concat([{
    address: "0xtop",
    class: "chromium",
    fullscreen: 2,
    at: [0, 0],
    size: [1000, 1000]
  }])
  assert.ok(model.paneLayout(covered).under.length <= model.maxRenderedPanesPerTile())
})

test("76 compositor collectors are bounded at the command boundary", function() {
  for (const query of ["clients", "workspaces", "monitors"]) {
    const argv = model.boundedHyprctlArgv(query)
    assert.strictEqual(argv[0], "bash")
    assert.ok(argv.join("\n").indexOf("hyprctl -j") >= 0)
    assert.ok(argv.join("\n").indexOf("head -c") >= 0)
    assert.ok(argv.indexOf(query) >= 0)
    assert.strictEqual(argv[argv.length - 1], String(model.maxCompositorOutputBytes() + 1))
  }
  same(model.boundedHyprctlArgv("dispatch"), [])
})

test("77 filterTiles matches workspace number or app label, keeping numeric order", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  stage.workspaces.push({ n: 10, windows: [{ class: "chromium", title: "far" }] })
  const tiles = model.workspaceTiles(stage)
  assert.strictEqual(tiles.length, 10)
  assert.strictEqual(model.filterTiles(tiles, "").length, tiles.length)
  assert.strictEqual(model.filterTiles(tiles, "   ").length, tiles.length)
  const byNumber = model.filterTiles(tiles, "2")
  assert.strictEqual(byNumber.length, 1)
  assert.strictEqual(byNumber[0].n, 2)
  const byLabel = model.filterTiles(tiles, tiles[0].label.slice(0, 3))
  assert.ok(byLabel.length >= 1)
  assert.strictEqual(byLabel[0].n, tiles[0].n)
  same(model.filterTiles(tiles, "no such workspace"), [])
  // The vacant tile is only reachable by its number, never by the word Empty.
  same(model.filterTiles(tiles, "empty"), [])
  assert.strictEqual(model.filterTiles(tiles, "4")[0].vacant, true)
  const lastDigit = model.filterTiles(tiles, "1")
  const ns = Array.from(lastDigit.map((t) => t.n))
  same(ns, Array.from(ns).sort((a, b) => a - b))
  assert.ok(ns.length >= 2)
  same(model.filterTiles(null, "x"), [])
})

test("78 QML reads only the compositor, escapes Text, and calls only functions Model.js still has", function() {
  const overlay = fs.readFileSync(path.join(__dirname, "..", "Overlay.qml"), "utf8")
  const bar = fs.readFileSync(path.join(__dirname, "..", "BarWidget.qml"), "utf8")

  assert.ok(overlay.indexOf("Model.boundedHyprctlArgv") >= 0)
  for (const [name, source] of [["Overlay.qml", overlay], ["BarWidget.qml", bar]]) {
    for (const gone of ["desks.json", "FileView", "ConfirmDialog", "special:omadesk", "park"]) {
      assert.strictEqual(source.indexOf(gone), -1, name + " still mentions " + gone)
    }
    // Repeater delegates see tile data as QML list wrappers, and Array.isArray is false for those.
    assert.strictEqual(source.indexOf("Array.isArray"), -1, name + " must not rely on Array.isArray")
    const textItems = (source.match(/\bText\s*\{/g) || []).length
    const plainItems = (source.match(/textFormat:\s*Text\.PlainText/g) || []).length
    assert.ok(textItems > 0, name + " should render at least one local Text item")
    assert.strictEqual(plainItems, textItems, name + " has a Text item using AutoText")

    // check_refs.js only sees bare calls inside Model.js, so a Model.foo() in QML
    // that points at a deleted function would otherwise fail at runtime only.
    const called = new Set((source.match(/\bModel\.([A-Za-z_][A-Za-z0-9_]*)/g) || []).map((c) => c.slice(6)))
    called.delete("js")
    for (const fn of called) {
      assert.strictEqual(typeof model[fn], "function", name + " calls Model." + fn + ", which Model.js does not define")
    }
  }
})

console.log("ok")
