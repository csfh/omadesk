import QtQuick
import Quickshell
import qs.Ui
import qs.Commons

BarWidget {
  id: root
  moduleName: "com.mdtrr.omadesk"

  readonly property color barFg: bar ? bar.barForeground : Color.foreground

  function toggleOverlay() {
    if (root.bar && root.bar.shell && typeof root.bar.shell.toggle === "function") {
      root.bar.shell.toggle(root.moduleName)
      return
    }
    Util.execDetached("omarchy-shell shell toggle " + Util.shellQuote(root.moduleName))
  }

  implicitWidth: button.implicitWidth
  implicitHeight: barSize
  visible: true

  WidgetButton {
    id: button
    anchors.centerIn: parent
    bar: root.bar
    text: " "
    labelVisible: false
    fixedWidth: chipLabel.implicitWidth + scaledHorizontalMargin * 2
    tooltipText: "Open Desks"
    foreground: root.barFg
    useActiveColor: false
    dimmed: false
    horizontalMargin: 6
    verticalPadding: 6
    onPressed: root.toggleOverlay()

    Text {
      id: chipLabel
      anchors.centerIn: parent
      text: "Desks"
      textFormat: Text.PlainText
      color: root.barFg
      font.family: button.fontFamily
      font.pixelSize: button.fontSize
      renderType: Text.NativeRendering
    }
  }
}
