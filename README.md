# Virtual-Launcher

A console-style game launcher, built with Python's Tkinter. It skins your desktop
apps and games as a Windows Media Center-style menu — a category list you can
navigate with a D-pad, where the focused category expands into a strip of
glowing tiles you add, launch, and manage without ever touching a keyboard
shortcut menu.

## Running it

```
python3 console_launcher.py
```

No pip installs required — everything is Python's standard library. `sips`
(for pulling a real app icon on macOS) is built in, so that works out of the
box; icon extraction is macOS-only today, other platforms fall back to a
plain letter tile.

## What it does

- **Games** and **Settings** — the two categories in the main menu. Up/Down
  switches which one is focused; the focused category expands into a
  horizontal strip of tiles.
- **Launch a game** — click (or select + Enter) a tile in the Games strip.
  The launcher fully closes while the game runs and reopens automatically
  the moment you quit it.
- **Settings** strip —
  - **Add Game** — pick any app/executable via a file browser; it shows up
    as a tile in the Games strip. On macOS, its real icon is extracted
    automatically.
  - **Remove Game** — pick a tile to delete it from the launcher.
  - **Menu Color** — an R/G/B adjuster screen (Up/Down picks a channel,
    Left/Right adjusts it) that recolors the whole menu — tiles, header, and
    background glow — from one accent color.
- **Power button** (top-right) — quits the launcher.

## Controller / keyboard support

There's no raw-gamepad code — instead, every screen responds to:

- **Left / Right** — move between tiles in the focused strip
- **Up / Down** — switch categories on the main menu; picks a channel on the
  R/G/B color screen
- **Enter / Space** — activate the highlighted tile
- **Escape** — go back

Any controller-to-keyboard mapper (Steam Input, DS4Windows, OS-level remapping,
etc.) maps a D-pad and a couple of face buttons to these keys, and the whole
launcher — menus, settings, color picker — becomes controller-operable with no
extra setup on our end.

## Files

| Path | What it is |
|---|---|
| `console_launcher.py` | The actual launcher — everything above lives here. |
| `apps.json` | Your added games (name, path, cached icon). Generated at runtime. |
| `settings.json` | Menu color settings. Generated at runtime. |
| `assets/` | Icons bundled with the launcher. |
| `pictures/` | The window's own icon. |
| `guide/` | Reference UI used for visual/asset inspiration. Not part of the app; gitignored. |

## Notes

- `apps.json` and `settings.json` are created next to the script the first time
  you run it, and updated automatically as you use the launcher — there's
  nothing to configure by hand.
- Icon extraction (showing a real app icon on its tile) only works on macOS
  today; Windows and Linux games fall back to a plain letter tile.
