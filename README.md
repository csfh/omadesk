# Desks

```
      +---------+
      |  o   o  |
      |    ~    |
      +----+----+
     /|         |\
     \|_________|/
       ||     ||
      _||     ||_
```

Workspace manager overlay for Omarchy Quattro. A desk here is an ordinary
Hyprland workspace, 1–10. The overlay shows all ten as tiles in a fixed
order, 1–5 on top and 6–10 below, so a workspace never changes place when it
fills up or empties. Occupied ones are drawn from the real window geometry,
with app icons, at the monitor's aspect ratio; the rest are empty slots you can
drop windows onto. Nothing is
parked, saved or restored: Hyprland owns placement, and the overlay reads it
fresh every time it opens. Scratchpad and other special workspaces are never
shown or touched.

![Desks picker](preview.png)

## Install

```sh
omarchy plugin add https://github.com/modoterra/omadesk.git --enable
```

From this checkout:

```sh
omarchy plugin add /path/to/omadesk --enable
```

There is no installer script. The plugin is QML + JavaScript only.

Put the chip next to the stock workspace numbers:

```sh
omarchy bar move com.mdtrr.omadesk --section left
```

## Summon

```sh
omarchy-shell shell toggle com.mdtrr.omadesk
```

Suggested bind: Super+D. Super+Space stays the Omarchy menu. Super+Shift+D
is Omarchy’s Docker TUI, so this plugin does not take that key.

```lua
o.bind("SUPER + D", "Desks", "omarchy-shell shell toggle com.mdtrr.omadesk")
```

## Keys

| Key | Action |
| --- | --- |
| Super+D | toggle overlay |
| / | start filter by workspace number or app (Esc leaves) |
| j / k, arrows, h l | move cursor |
| 0–9 | put the cursor on that workspace (0 is 10) |
| enter, or click a tile | go to that workspace |
| drag a window pane onto another tile | move that window there |
| drag a pane onto an empty tile | put it on that workspace |
| drag a tile onto another tile (or an empty one) | swap the two workspaces' windows |
| D / L in the tile header | toggle dwindle and scrolling |
| esc | close (clear filter first if any) |

## Remove

```sh
omarchy plugin remove com.mdtrr.omadesk
```

Earlier versions kept named desks in `~/.config/omarchy/omadesk/desks.json`
and parked windows on `special:omadesk-<id>-N` workspaces. Both are gone. The
file is no longer read and is safe to delete. If a window is still parked on
one of those special workspaces, move it back with
`hyprctl dispatch movetoworkspace 1,address:<addr>`.

## Tests

```sh
node tests/test_model.js
node tests/check_refs.js
omarchy plugin validate .
```

## Security

Plugins run unsandboxed inside the long-lived Omarchy shell process, with
your user permissions. Review the code before you enable it. Hyprctl is
the only command used to read and move windows. The D / L toggle also writes
a workspace rule file under `~/.local/state/omarchy/workspace-layouts`, the
same place Omarchy's own Super+L writes.

## Community

Use common sense and decency. There is no formal code of conduct. We reserve the right to moderate this community to the extent of the law and the policy of the host. Write community@modoterra.xyz if you need us.
