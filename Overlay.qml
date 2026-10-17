import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Model.js" as Model

Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool opened: false
  property string filterText: ""
  property bool filterOpen: false
  property int cursorIndex: 0
  property bool placeCursor: false
  property var stage: ({})
  property var tiles: []
  property int usedCount: 0
  property string clientsJson: ""
  property string workspacesJson: ""
  property string monitorsJson: ""
  property var stageCallback: null
  property bool stageQueued: false

  property color accent: Color.accent
  property color background: Color.popups.background
  property color foreground: Color.popups.text
  property color border: Color.popups.border
  property var borderSpec: Border.surfaceSpec("popups", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color fill: Style.normalFillFor(foreground, accent)
  property color fillHover: Style.hoverFillFor(foreground, accent)
  property color fillSelected: Style.selectedFillFor(foreground, accent)
  property color borderSoft: Style.normalBorderFor(foreground, accent)
  property color tileFill: Style.normalFillFor(foreground, accent)
  property color dim: Qt.darker(foreground, 1.4)
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.family
  property int contentMargin: Style.spacing.popupPadding
  property int cardWidth: Math.min(Style.space(860), panel.width - Style.gapsOut * 2)
  property int gridGap: Style.space(8)
  property int tileColumns: 5
  property int tileWidth: Math.max(1, Math.floor((cardWidth - card.contentLeftInset - card.contentRightInset - gridGap * (tileColumns - 1)) / tileColumns))
  readonly property string layoutsDir: Model.workspaceLayoutsDir(Quickshell.env("HOME"), Quickshell.env("XDG_STATE_HOME"))
  readonly property int maxRenderedPanesPerTile: Model.maxRenderedPanesPerTile()
  readonly property var focusedN: root.stage && root.stage.lastWorkspace != null ? Number(root.stage.lastWorkspace) : null
  function pluginId() {
    return (root.manifest && root.manifest.id) || "com.mdtrr.omadesk"
  }

  function open() {
    root.opened = true
    root.filterText = ""
    root.filterOpen = false
    root.cursorIndex = 0
    root.placeCursor = true
    root.refreshStage(null)
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide(root.pluginId())
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open()
  }

  function applyEscape() {
    if (root.filterOpen || root.filterText) root.closeFilter()
    else root.dismiss()
  }

  function openFilter() {
    root.filterOpen = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function closeFilter() {
    root.filterOpen = false
    root.setFilter("")
  }

  function setFilter(text) {
    root.filterText = String(text || "").slice(0, 128)
    root.cursorIndex = 0
    root.rebuildTiles()
  }

  readonly property string headerTitleText: {
    if (root.filterOpen) return root.filterText || "Search Workspaces…"
    return "Desks"
  }

  readonly property string headerMetaText: {
    if (root.filterOpen) return ""
    return root.usedCount + (root.usedCount === 1 ? " workspace in use" : " workspaces in use")
  }

  readonly property bool showFilterHint: !root.filterOpen

  function cardFill(hasCursor, isFocused) {
    if (isFocused) return root.fillSelected
    if (hasCursor) return root.fillHover
    return root.fill
  }

  function reservedControlBorderWidth() {
    var w = Math.max(1, Style.normalBorderWidth, Style.hoverBorderWidth)
    if (Style.selectedBorderWidth > 0) w = Math.max(w, Style.selectedBorderWidth)
    return w
  }

  function iconSource(iconOrWin) {
    var names = []
    if (iconOrWin && typeof iconOrWin === "object") {
      if (iconOrWin.icon) names.push(String(iconOrWin.icon))
      var extra = Model.iconNames(iconOrWin) || []
      for (var e = 0; e < extra.length; e++) names.push(extra[e])
      if (iconOrWin.class) names.push(String(iconOrWin.class))
    } else if (iconOrWin) {
      names.push(String(iconOrWin))
    }
    for (var i = 0; i < names.length; i++) {
      if (!names[i]) continue
      var path = Quickshell.iconPath(names[i], true)
      if (path) return path
    }
    return ""
  }

  function iconLetters(app) {
    return Model.iconLetters(app)
  }

  function rebuildTiles() {
    var all = Model.workspaceTiles(root.stage, 10)
    var used = 0
    for (var i = 0; i < all.length; i++) {
      if (!all[i].vacant) used += 1
    }
    root.usedCount = used
    root.tiles = Model.filterTiles(all, root.filterText)
    if (root.placeCursor && root.filterText === "" && root.focusedN != null) {
      root.cursorIndex = Model.tileIndexForN(root.tiles, root.focusedN, 0)
      root.placeCursor = false
    }
    if (root.cursorIndex >= root.tiles.length) root.cursorIndex = Math.max(0, root.tiles.length - 1)
    if (root.cursorIndex < 0) root.cursorIndex = 0
  }

  function highlightedTile() {
    if (root.cursorIndex < 0 || root.cursorIndex >= root.tiles.length) return null
    return root.tiles[root.cursorIndex]
  }

  function moveCursor(dx, dy) {
    if (root.tiles.length === 0) return
    root.cursorIndex = Model.moveCursor(root.cursorIndex, root.tiles.length, dx, dy, root.tileColumns)
  }

  function jumpToWorkspace(n) {
    root.cursorIndex = Model.tileIndexForN(root.tiles, n, root.cursorIndex)
  }

  function focusWorkspaceNow(n) {
    var lua = Model.focusDispatch(String(n))
    if (!lua) return
    Quickshell.execDetached(["hyprctl", "dispatch", lua])
  }

  function goToWorkspace(n) {
    var target = Model.focusWorkspaceN(n)
    if (!target) return
    root.focusWorkspaceNow(target)
    root.dismiss()
  }

  function activateHighlighted() {
    var tile = root.highlightedTile()
    if (tile) root.goToWorkspace(tile.n)
  }

  function setWorkspaceLayout(tileData, layout) {
    if (!tileData) return
    var target = Model.workspaceLayoutTarget(tileData)
    if (!target) return
    var next = layout ? Model.normalizeTiledLayout(layout) : Model.nextTiledLayout(tileData.tiledLayout)
    var argv = Model.workspaceLayoutApplyArgv(root.layoutsDir, target, next)
    if (!argv.length) return
    if (layoutApplyProc.running) layoutApplyProc.running = false
    layoutApplyProc.command = argv
    layoutApplyProc.running = true
  }

  // Placement is Hyprland's. A drop moves real windows and then re-reads the
  // compositor, so there is no stored order that can drift out of sync.
  function movePane(address, fromN, toN) {
    if (movePaneProc.running) return
    var lua = Model.windowMoveDispatch(address, fromN, toN)
    if (!lua) return
    movePaneProc.command = ["hyprctl", "dispatch", lua]
    movePaneProc.running = true
  }

  function swapWorkspaces(fromN, toN) {
    if (moveWsProc.running) return
    var plan = Model.swapWorkspacePlan(root.stage, fromN, toN)
    if (!plan || !plan.batch) return
    moveWsProc.command = ["hyprctl", "--batch", plan.batch]
    moveWsProc.running = true
  }

  function refreshStage(cb) {
    if (clientsProc.running || workspacesProc.running || monitorsProc.running) {
      root.stageCallback = cb
      root.stageQueued = true
      return
    }
    root.stageCallback = cb
    root.clientsJson = ""
    root.workspacesJson = ""
    root.monitorsJson = ""
    clientsProc.command = Model.boundedHyprctlArgv("clients")
    clientsProc.running = true
  }

  function failStage() {
    var cb = root.stageCallback
    root.stageCallback = null
    root.stageQueued = false
    if (typeof cb === "function") cb(false)
  }

  function finishStage() {
    var stage = Model.parseStage(root.clientsJson, root.workspacesJson, root.monitorsJson)
    if (!stage || stage.valid === false) {
      root.failStage()
      return
    }
    root.stage = stage
    root.completeStage(true)
  }

  function completeStage(ok) {
    if (ok) root.rebuildTiles()
    var cb = root.stageCallback
    root.stageCallback = null
    if (root.stageQueued) {
      root.stageQueued = false
      root.refreshStage(cb)
      return
    }
    if (typeof cb === "function") cb(!!ok)
  }

  function handleKey(event) {
    var plain = !(event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier))
    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      root.activateHighlighted()
      event.accepted = true
      return
    }
    if ((event.key === Qt.Key_Slash || event.text === "/") && !root.filterOpen) {
      root.openFilter()
      event.accepted = true
      return
    }
    if (root.filterOpen) {
      if (Util.editsFilter(event, root.filterText)) {
        root.setFilter(Util.editedFilter(event, root.filterText))
        event.accepted = true
        return
      }
      if (event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127) {
        if (!plain) return
        root.setFilter(root.filterText + event.text)
        event.accepted = true
        return
      }
    }
    if (event.key === Qt.Key_Down) {
      root.moveCursor(0, 1)
      event.accepted = true
    } else if (event.key === Qt.Key_Up) {
      root.moveCursor(0, -1)
      event.accepted = true
    } else if (event.key === Qt.Key_Left) {
      root.moveCursor(-1, 0)
      event.accepted = true
    } else if (event.key === Qt.Key_Right) {
      root.moveCursor(1, 0)
      event.accepted = true
    } else if (!root.filterOpen && plain && event.key >= Qt.Key_0 && event.key <= Qt.Key_9) {
      root.jumpToWorkspace(event.key === Qt.Key_0 ? 10 : event.key - Qt.Key_0)
      event.accepted = true
    } else if (!root.filterOpen && event.text === "j") {
      root.moveCursor(0, 1)
      event.accepted = true
    } else if (!root.filterOpen && event.text === "k") {
      root.moveCursor(0, -1)
      event.accepted = true
    } else if (!root.filterOpen && event.text === "h") {
      root.moveCursor(-1, 0)
      event.accepted = true
    } else if (!root.filterOpen && event.text === "l") {
      root.moveCursor(1, 0)
      event.accepted = true
    }
  }

  IpcHandler {
    target: "com.mdtrr.omadesk"
    function open(): void { root.open() }
    function close(): void { root.dismiss() }
    function show(): void { root.open() }
    function hide(): void { root.dismiss() }
    function toggle(): void { root.toggle() }
  }

  Process {
    id: layoutApplyProc
    onExited: function() {
      root.refreshStage(null)
    }
  }

  Process {
    id: movePaneProc
    onExited: function() {
      root.refreshStage(null)
    }
  }

  Process {
    id: moveWsProc
    onExited: function() {
      root.refreshStage(null)
    }
  }

  Process {
    id: clientsProc
    stdout: StdioCollector {
      id: clientsOut
      waitForEnd: true
    }
    onExited: function(code) {
      var output = String(clientsOut.text || "")
      if (code !== 0 || !Model.isWithinUtf8ByteLimit(output, Model.maxCompositorOutputBytes())) {
        root.failStage()
        return
      }
      root.clientsJson = output
      workspacesProc.command = Model.boundedHyprctlArgv("workspaces")
      workspacesProc.running = true
    }
  }

  Process {
    id: workspacesProc
    stdout: StdioCollector {
      id: workspacesOut
      waitForEnd: true
    }
    onExited: function(code) {
      var output = String(workspacesOut.text || "")
      if (code !== 0 || !Model.isWithinUtf8ByteLimit(output, Model.maxCompositorOutputBytes())) {
        root.failStage()
        return
      }
      root.workspacesJson = output
      monitorsProc.command = Model.boundedHyprctlArgv("monitors")
      monitorsProc.running = true
    }
  }

  Process {
    id: monitorsProc
    stdout: StdioCollector {
      id: monitorsOut
      waitForEnd: true
    }
    onExited: function(code) {
      var output = String(monitorsOut.text || "")
      root.monitorsJson = code === 0 && Model.isWithinUtf8ByteLimit(output, Model.maxCompositorOutputBytes())
        ? output
        : "[]"
      root.finishStage()
    }
  }

  component KeyHint: Row {
    property string chord: ""
    property string label: ""
    property bool sep: false

    spacing: 0

    Text {
      text: chord
      textFormat: Text.PlainText
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
    }
    Text {
      text: " " + label + (sep ? "  ·  " : "")
      textFormat: Text.PlainText
      color: root.dim
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  component WorkspaceTile: BorderSurface {
    id: tile
    property var tileData: ({})
    property bool clickable: false
    signal activated()
    signal layoutChosen(string layout)
    signal paneDropped(string address, var fromN)
    signal workspaceDropped(var fromN)
    signal hovered()

    property bool hasCursor: false
    property bool focusedWorkspace: false
    property bool panesDraggable: false
    property bool workspacesDraggable: false
    property bool paneDragging: false
    property bool workspaceDragging: false
    property string layoutOverride: ""
    property real dragOriginX: 0
    property real dragOriginY: 0
    readonly property string paneDragKey: "omadesk-pane"
    readonly property string workspaceDragKey: "omadesk-ws"
    readonly property var fromWorkspaceN: tile.tileData ? tile.tileData.n : null

    readonly property bool canToggleLayout: !!tile.tileData && !!Model.workspaceLayoutTarget(tile.tileData)
    readonly property bool scrollingLayout: {
      var raw = tile.layoutOverride !== "" ? tile.layoutOverride : (tile.tileData && tile.tileData.tiledLayout)
      return Model.normalizeTiledLayout(raw) === "scrolling"
    }

    readonly property bool vacant: !!(tile.tileData && tile.tileData.vacant)
    readonly property string tileId: {
      var d = tile.tileData || ({})
      var n = Number(d.n)
      if (n >= 1 && n <= 10) return String(n)
      return ""
    }
    readonly property string tileLabel: tile.tileData ? String(tile.tileData.label || (tile.vacant ? "Empty" : "")) : ""
    // Repeater hands tile data over as a QML list wrapper, which is not a plain
    // JS array even though it indexes like one, so the type is never tested here.
    readonly property var panes: tile.tileData && tile.tileData.panes
      ? Array.prototype.slice.call(tile.tileData.panes, 0, root.maxRenderedPanesPerTile)
      : []
    readonly property var under: tile.tileData && tile.tileData.under
      ? Array.prototype.slice.call(tile.tileData.under, 0, root.maxRenderedPanesPerTile)
      : []
    readonly property bool hasUnder: !tile.vacant && tile.under && tile.under.length > 0
    readonly property int underStrip: tile.hasUnder ? 36 : 0
    readonly property int paneGap: 2
    readonly property int iconPad: 4
    readonly property int chromePad: Style.space(6)
    readonly property int chromeGap: Style.space(4)
    readonly property int chromeBorderWidth: root.reservedControlBorderWidth()
    readonly property int headerHeight: Math.max(
      idLabel.implicitHeight,
      layoutBtn.implicitHeight,
      Style.space(20)
    )
    readonly property int mapWidth: Math.max(1, width - tile.chromePad * 2)
    readonly property int mapHeight: Math.round(tile.mapWidth / tile.aspect)

    color: root.cardFill(tile.hasCursor, tile.focusedWorkspace)
    borderSpec: Border.withWidth(
      Border.controlSpec(tile.hasCursor ? "hover-cursor" : "normal", tile.vacant ? root.dim : root.foreground, root.accent),
      tile.chromeBorderWidth
    )
    radius: Style.cornerRadius
    readonly property real aspect: {
      var a = Number(tile.tileData && tile.tileData.aspect)
      if (isFinite(a) && a >= 0.3 && a <= 5) return a
      return 16 / 9
    }
    implicitHeight: tile.chromePad * 2 + tile.headerHeight + tile.chromeGap + tile.mapHeight + (tile.hasUnder ? tile.underStrip : 0)
    implicitWidth: Style.space(96)
    clip: !tile.paneDragging && !tile.workspaceDragging
    z: tile.workspaceDragging ? 40 : 0
    Drag.active: wsHandle.drag.active && tile.workspacesDraggable
    Drag.hotSpot.x: width / 2
    Drag.hotSpot.y: height / 2
    Drag.keys: tile.workspacesDraggable ? [tile.workspaceDragKey] : []
    Drag.source: tile
    Drag.proposedAction: Qt.MoveAction

    onTileDataChanged: tile.layoutOverride = ""

    HoverHandler {
      onHoveredChanged: if (hovered) tile.hovered()
    }

    DropArea {
      id: wsDrop
      anchors.fill: parent
      // While this tile is the drag source it sits under the cursor, so its own
      // DropArea would steal every drop and reject it as "same workspace".
      // Disable it for the duration of the drag so targets underneath receive it.
      // Vacant tiles are not drag sources but must still accept drops.
      enabled: !tile.workspaceDragging && (tile.workspacesDraggable || tile.vacant)
      keys: [tile.workspaceDragKey]
      onEntered: function(drag) {
        var src = drag.source
        if (!src || src.fromWorkspaceN == null || Number(src.fromWorkspaceN) === Number(tile.fromWorkspaceN))
          drag.accepted = false
      }
      onDropped: function(drop) {
        var src = drop.source
        var fromN = src ? src.fromWorkspaceN : null
        if (fromN != null)
          tile.workspaceDropped(fromN)
        drop.acceptProposedAction()
      }

      Rectangle {
        anchors.fill: parent
        visible: wsDrop.containsDrag
        z: 8
        color: "transparent"
        border.width: Style.normalBorderWidth + 1
        border.color: root.accent
        radius: Style.cornerRadius
      }
    }

    Column {
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.top: parent.top
      anchors.margins: tile.chromePad
      spacing: tile.chromeGap

      Item {
        width: parent.width
        height: tile.headerHeight

        MouseArea {
          id: wsHandle
          anchors.fill: parent
          anchors.rightMargin: tile.canToggleLayout ? layoutBtn.width + Style.space(4) : 0
          z: 1
          enabled: tile.clickable || tile.workspacesDraggable
          hoverEnabled: tile.clickable || tile.workspacesDraggable
          cursorShape: tile.workspacesDraggable ? Qt.OpenHandCursor : (tile.clickable ? Qt.PointingHandCursor : Qt.ArrowCursor)
          preventStealing: tile.workspacesDraggable
          drag.target: tile.workspacesDraggable ? tile : undefined
          drag.threshold: 10
          onPressed: {
            if (!tile.workspacesDraggable) return
            tile.dragOriginX = tile.x
            tile.dragOriginY = tile.y
            tile.workspaceDragging = true
          }
          onReleased: {
            // Prefer the MouseArea drag flag: the Drag.active binding can clear
            // before onReleased runs, which would skip Drag.drop() entirely.
            var dragging = wsHandle.drag.active || tile.Drag.active
            if (dragging) {
              // Drop while still dragging and while our DropArea stays disabled.
              // Snapping or clearing workspaceDragging first cancels the drag and
              // onDropped never runs (highlight was real; move was not).
              tile.Drag.drop()
              // Success rebuilds the tiles and destroys this tile. Failure leaves us
              // here — snap home. Touching a destroyed tile only warns.
              tile.workspaceDragging = false
              tile.x = tile.dragOriginX
              tile.y = tile.dragOriginY
            } else {
              tile.workspaceDragging = false
              if (tile.clickable)
                tile.activated()
            }
          }
          onCanceled: {
            tile.workspaceDragging = false
            tile.x = tile.dragOriginX
            tile.y = tile.dragOriginY
          }
        }

        Text {
          id: idLabel
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          visible: tile.tileId !== ""
          text: tile.tileId
          textFormat: Text.PlainText
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          font.weight: Font.Medium
        }

        Button {
          id: layoutBtn
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          z: tile.canToggleLayout ? 2 : 0
          visible: true
          opacity: tile.canToggleLayout ? 1 : 0
          enabled: tile.canToggleLayout
          text: tile.scrollingLayout ? "L" : "D"
          tooltipText: tile.scrollingLayout ? "Scrolling" : "Dwindle"
          bordered: true
          foreground: root.foreground
          accent: root.accent
          fontFamily: root.fontFamily
          fontSize: Style.font.caption
          horizontalPadding: Style.space(6)
          verticalPadding: Style.space(2)
          onClicked: {
            var next = tile.scrollingLayout ? "dwindle" : "scrolling"
            tile.layoutOverride = next
            tile.layoutChosen(next)
          }
        }
      }

      DropArea {
        id: inner
        width: parent.width
        height: tile.mapHeight
        clip: !tile.paneDragging && !tile.workspaceDragging
        keys: tile.paneDragKey !== "" && tile.panesDraggable ? [tile.paneDragKey] : []
        onEntered: function(drag) {
          var src = drag.source
          if (src && Number(src.fromWorkspaceN) === Number(tile.tileData && tile.tileData.n))
            drag.accepted = false
        }
        onDropped: function(drop) {
          var src = drop.source
          var addr = src && src.paneAddress ? String(src.paneAddress) : ""
          if (addr)
            tile.paneDropped(addr, src.fromWorkspaceN)
          drop.acceptProposedAction()
        }

        BorderSurface {
          anchors.fill: parent
          color: Util.alpha(root.foreground, 0.04)
          borderSpec: Border.withWidth(
            Border.controlSpec("normal", tile.vacant ? root.dim : root.foreground, root.accent),
            tile.chromeBorderWidth
          )
          radius: Style.cornerRadius
        }

        Rectangle {
          anchors.fill: parent
          visible: inner.containsDrag
          z: 7
          color: "transparent"
          border.width: Style.normalBorderWidth + 1
          border.color: root.accent
          radius: Style.cornerRadius
        }

        Item {
          id: map
          anchors.fill: parent
          anchors.margins: 2
          visible: !tile.vacant && tile.panes && tile.panes.length
          z: 5

          Repeater {
            model: map.visible ? tile.panes : []

            delegate: Rectangle {
              id: pane
              required property var modelData
              readonly property real px: Number(modelData && modelData.x)
              readonly property real py: Number(modelData && modelData.y)
              readonly property real pw: Number(modelData && modelData.w)
              readonly property real ph: Number(modelData && modelData.h)
              readonly property string paneAddress: String((modelData && modelData.address) || "")
              readonly property var fromWorkspaceN: tile.tileData ? tile.tileData.n : null
              readonly property bool canDragPane: tile.panesDraggable && pane.paneAddress !== "" && tile.paneDragKey !== ""

              x: map.width * (isFinite(px) ? px : 0) + tile.paneGap / 2
              y: map.height * (isFinite(py) ? py : 0) + tile.paneGap / 2
              width: Math.max(Style.space(8), map.width * (isFinite(pw) ? pw : 0) - tile.paneGap)
              height: Math.max(Style.space(8), map.height * (isFinite(ph) ? ph : 0) - tile.paneGap)
              color: Util.alpha(root.foreground, modelData && modelData.floating ? 0.10 : 0.05)
              border.width: Style.normalBorderWidth
              border.color: Style.normalBorderFor(root.foreground, root.accent)
              radius: Style.cornerRadius
              z: paneDrag.drag.active ? 20 : 0
              opacity: paneDrag.drag.active ? 0.92 : 1

              Drag.active: paneDrag.drag.active
              Drag.hotSpot.x: width / 2
              Drag.hotSpot.y: height / 2
              Drag.keys: pane.canDragPane ? [tile.paneDragKey] : []
              Drag.source: pane
              Drag.proposedAction: Qt.MoveAction

              function resetPanePos() {
                pane.x = Qt.binding(function() {
                  return map.width * (isFinite(pane.px) ? pane.px : 0) + tile.paneGap / 2
                })
                pane.y = Qt.binding(function() {
                  return map.height * (isFinite(pane.py) ? pane.py : 0) + tile.paneGap / 2
                })
              }

              Image {
                id: paneIcon
                anchors.centerIn: parent
                width: Math.max(0, Math.min(Style.space(22), Math.min(parent.width, parent.height) - tile.iconPad * 2))
                height: width
                fillMode: Image.PreserveAspectFit
                asynchronous: true
                sourceSize.width: width * Screen.devicePixelRatio
                sourceSize.height: height * Screen.devicePixelRatio
                source: root.iconSource(modelData)
                visible: status === Image.Ready
              }

              Text {
                visible: paneIcon.status !== Image.Ready
                anchors.centerIn: parent
                text: root.iconLetters(modelData)
                textFormat: Text.PlainText
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Math.max(Style.font.caption, Math.min(parent.width, parent.height) * 0.32)
                font.weight: Font.DemiBold
              }

              MouseArea {
                id: paneDrag
                anchors.fill: parent
                enabled: pane.canDragPane
                hoverEnabled: pane.canDragPane
                cursorShape: pane.canDragPane ? Qt.OpenHandCursor : Qt.ArrowCursor
                preventStealing: true
                drag.target: pane
                drag.threshold: 10
                onPressed: tile.paneDragging = true
                onReleased: {
                  if (pane.Drag.active)
                    pane.Drag.drop()
                  else if (tile.clickable)
                    tile.activated()
                  tile.paneDragging = false
                  pane.resetPanePos()
                }
                onCanceled: {
                  tile.paneDragging = false
                  pane.resetPanePos()
                }
              }
            }
          }
        }

        Rectangle {
          visible: tile.vacant
          anchors.centerIn: parent
          z: 3
          color: root.tileFill
          border.width: 0
          radius: 0
          implicitWidth: emptyLabel.implicitWidth + 16
          implicitHeight: emptyLabel.implicitHeight + 8

          Text {
            id: emptyLabel
            anchors.centerIn: parent
            text: "Empty"
            textFormat: Text.PlainText
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        Text {
          visible: !tile.vacant && !(tile.panes && tile.panes.length)
          anchors.fill: parent
          anchors.margins: Style.space(6)
          z: 3
          text: tile.tileLabel
          textFormat: Text.PlainText
          color: Util.alpha(root.foreground, 0.78)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.Wrap
          maximumLineCount: 2
          elide: Text.ElideRight
          verticalAlignment: Text.AlignVCenter
          horizontalAlignment: Text.AlignHCenter
        }

        MouseArea {
          anchors.fill: parent
          enabled: tile.clickable
          hoverEnabled: tile.clickable
          cursorShape: tile.clickable ? Qt.PointingHandCursor : Qt.ArrowCursor
          z: 2
          onClicked: tile.activated()
        }
      }

      Item {
        visible: tile.hasUnder
        width: parent.width
        height: tile.hasUnder ? tile.underStrip : 0

        Rectangle {
          id: underRule
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.top: parent.top
          height: 1
          color: root.borderSoft
        }

        Item {
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.top: underRule.bottom
          anchors.bottom: parent.bottom

          Row {
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: 8
            spacing: 8

            Repeater {
              model: tile.hasUnder ? tile.under : []

              delegate: Item {
                required property var modelData
                width: 16
                height: 16

                Image {
                  id: underIcon
                  anchors.fill: parent
                  fillMode: Image.PreserveAspectFit
                  asynchronous: true
                  sourceSize.width: width * Screen.devicePixelRatio
                  sourceSize.height: height * Screen.devicePixelRatio
                  source: root.iconSource(modelData)
                  visible: status === Image.Ready
                  opacity: 0.9
                }

                Text {
                  visible: underIcon.status !== Image.Ready
                  anchors.centerIn: parent
                  text: root.iconLetters(modelData)
                  textFormat: Text.PlainText
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.weight: Font.DemiBold
                }
              }
            }
          }
        }
      }
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "com-mdtrr-omadesk"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      implicitHeight: Math.min(
        contentColumn.implicitHeight + card.contentTopInset + card.contentBottomInset,
        Math.max(Style.space(200), panel.height - Math.max(Style.space(80), panel.height * 0.12) - Style.gapsOut * 2)
      )
      radius: root.cornerRadius
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.top: parent.top
      anchors.topMargin: Math.max(Style.space(80), panel.height * 0.12)
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true
        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) {
            root.applyEscape()
            event.accepted = true
            return
          }
          root.handleKey(event)
        }
      }

      Column {
        id: contentColumn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.topMargin: card.contentTopInset
        anchors.leftMargin: card.contentLeftInset
        anchors.rightMargin: card.contentRightInset
        spacing: Style.space(12)

        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, filterHint.implicitHeight)

          Text {
            id: heroIcon
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            text: "󰍺"
            textFormat: Text.PlainText
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.display
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: filterHint.left
            anchors.rightMargin: Style.space(12)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              width: parent.width
              text: root.headerTitleText
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
            }

            Text {
              width: parent.width
              visible: text !== ""
              text: root.headerMetaText.toUpperCase()
              textFormat: Text.PlainText
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
            }
          }

          Row {
            id: filterHint
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            visible: root.showFilterHint
            width: visible ? implicitWidth : 0
            spacing: 0

            Text {
              text: "TYPE "
              textFormat: Text.PlainText
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
            }
            Text {
              text: "/"
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
            }
            Text {
              text: " TO FILTER"
              textFormat: Text.PlainText
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
            }
          }
        }

        Text {
          width: parent.width
          visible: root.tiles.length === 0
          text: "No workspace matches."
          textFormat: Text.PlainText
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
        }

        GridLayout {
          id: tileGrid
          width: parent.width
          visible: root.tiles.length > 0
          columns: root.tileColumns
          columnSpacing: root.gridGap
          rowSpacing: root.gridGap
          uniformCellWidths: true
          uniformCellHeights: true

          Repeater {
            model: tileGrid.visible ? root.tiles : []

            delegate: WorkspaceTile {
              required property int index
              required property var modelData

              Layout.fillWidth: true
              Layout.fillHeight: true
              Layout.preferredWidth: root.tileWidth
              Layout.preferredHeight: implicitHeight
              Layout.minimumHeight: implicitHeight
              tileData: modelData
              clickable: true
              panesDraggable: true
              workspacesDraggable: !modelData.vacant
              hasCursor: index === root.cursorIndex
              focusedWorkspace: root.focusedN === Number(modelData.n)
              onHovered: root.cursorIndex = index
              onLayoutChosen: function(layout) { root.setWorkspaceLayout(modelData, layout) }
              onPaneDropped: function(address, fromN) { root.movePane(address, fromN, modelData.n) }
              onWorkspaceDropped: function(fromN) { root.swapWorkspaces(fromN, modelData.n) }
              onActivated: {
                root.cursorIndex = index
                root.goToWorkspace(modelData.n)
              }
            }
          }
        }

        PanelSeparator {
          foreground: root.foreground
        }

        Item {
          width: parent.width
          implicitHeight: Style.space(22)

          Row {
            visible: root.filterOpen
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            KeyHint { chord: "enter"; label: "Go To"; sep: true }
            KeyHint { chord: "esc"; label: "Leave Filter" }
          }

          Row {
            visible: !root.filterOpen
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            KeyHint { chord: "enter"; label: "Go To"; sep: true }
            KeyHint { chord: "0–9"; label: "Pick"; sep: true }
            KeyHint { chord: "/"; label: "Filter" }
          }

          Row {
            visible: !root.filterOpen
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            KeyHint { chord: "esc"; label: "Close" }
          }
        }
      }
    }
  }
}
