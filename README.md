# Virtual-Launcher

A console-style game launcher, built with Python's Tkinter. It skins your desktop
apps and games as a PS4-style menu — tiles you can add, launch, and manage without
ever touching a keyboard shortcut menu — and it's fully navigable with just a
D-pad-mapped controller.

## Running it

```
python3 console_launcher.py
```

No pip installs required — everything is Python's standard library. A few
optional things improve the experience if present on your system:

- **macOS**: `sips` (for pulling an app's real icon) and `afplay` (for sound) are
  built in, so these work out of the box.
- **Linux**: install `mpg123` or `ffplay` if you want background music / sound
  effects to play.
- **Windows**: sound playback isn't wired up (no equivalent found); everything
  else works.

## What it does

- **Add Game** — pick any app/executable via a file browser; it shows up as a
  tile on the main menu. On macOS, its real icon is extracted automatically.
- **Launch a game** — click (or select + Enter) a tile. The launcher fully
  closes while the game runs and reopens automatically the moment you quit it.
- **Settings** (gear icon, top-right) —
  - **Remove Game** — pick a tile to delete it from the launcher.
  - **Music** — set background music from a file, replay anything you've used
    before from a remembered recent list, or turn it off.
  - **Menu Color** — an R/G/B adjuster screen (Up/Down picks a channel,
    Left/Right adjusts it) that recolors the whole menu — tiles, header, and
    background — from one value.
  - **Background Style** — five generated background patterns (Waves, Rings,
    Diagonal, Sunburst, Halftone), each shown as a live preview before you pick.
- **Mute button** (top-right) — silences background music without losing your
  place; unmute picks up where it left off.

## Controller / keyboard support

There's no raw-gamepad code — instead, every screen responds to:

- **Left / Right** — move between tiles
- **Up / Down** — used only on the R/G/B color screen, to pick a channel
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
| `settings.json` | Menu color, background style, mute state, music path/history. Generated at runtime. |
| `assets/` | Icons and sounds bundled with the launcher. |
| `pictures/` | The window's own icon. |
| `guide/` | Reference UI (a PS4 web-clone project) used for visual/asset inspiration. Not part of the app; gitignored. |
| `launcher.py`, `launcher_unix.py` | An earlier, much simpler entry-box launcher (Windows and macOS/Linux versions) — superseded by `console_launcher.py`. |

## Notes

- `apps.json` and `settings.json` are created next to the script the first time
  you run it, and updated automatically as you use the launcher — there's
  nothing to configure by hand.
- Icon extraction (showing a real app icon on its tile) only works on macOS
  today; Windows and Linux games fall back to a plain letter tile.
