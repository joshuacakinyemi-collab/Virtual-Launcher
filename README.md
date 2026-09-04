# Virtual-Launcher

A console-style game launcher that skins your desktop apps and games as a
big-screen menu — a sidebar of games you browse and select, a detail/Play
screen for the one you land on, and a settings grid for everything else
(adding games, cover art, your profile, fonts, the clock). Built to be fully
controller-operable: every action lives in a navigable list, nothing is
hidden behind a mouse-only button.

There are two versions in this repo:

- **`electron/`** — the current, actively developed version (Electron/HTML/CSS/JS). This is the one to run.
- **`console_launcher.py`** — the original Python/Tkinter prototype. Still works standalone, no longer being extended.

## Running it

**Double-click `Virtual Launcher.app`** at the repo root. It's a thin
launcher script (not a portable/standalone build — see [Files](#files)),
so it only works from inside this checkout, but it means you don't need a
terminal open every time.

Or from a terminal:

```
cd electron
npm install   # first time only
npm start
```

The legacy Python version still runs standalone with no dependencies:

```
python3 console_launcher.py
```

## What it does

- **Games sidebar** — every added game, icon + name, always visible on the
  home screen. Select one to open its **detail/Play screen**: cover art,
  description, tags, total playtime, and Play/Cancel.
- **Playtime tracking** — automatic. The launcher hides while a game runs
  and records how long it was open; no manual bookkeeping.
- **Settings** — a wrapping grid, reached via the sidebar's own **Settings**
  entry:
  - **Add Game** — pick any app/executable via a file browser. On macOS its
    real icon is extracted automatically; optionally search
    [SteamGridDB](https://www.steamgriddb.com) for cover art instead.
  - **Remove Game**
  - **Update Game** — edit name/description/tags, and change its icon or
    banner (SteamGridDB search, or any image file of your own).
  - **Menu Color** — an R/G/B adjuster that recolors the whole UI (tiles,
    header, ambient background glow) from one accent color.
  - **Update User** — your profile name + icon shown in the header.
  - **Change Font** — import your own font file, plus Small/Medium/Large
    sizing.
  - **Time Setting** — timezone and 12h/24h format for the header clock
    (display only — it doesn't touch your system clock).
  - **Cover Art Key** — where you paste a free [SteamGridDB](https://www.steamgriddb.com/profile/preferences)
    API key. Stored outside the repo (see [Where your data lives](#where-your-data-lives)),
    never committed.
- **Quit** — also a sidebar entry, with a confirm prompt.

## Controller / keyboard support

Real gamepad support, not just a keyboard-remapper workaround — the renderer
polls the [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API)
(`navigator.getGamepads()`), which is part of Chromium itself, so Xbox,
PlayStation, and generic USB controllers all work identically on Windows,
Linux, and macOS with zero platform-specific code:

- **D-pad / left stick** — move through the sidebar, a settings/timezone
  list, or the Settings grid (2D: all four directions)
- **A / Cross** — activate the highlighted item (same as Enter)
- **B / Circle** — back (same as Escape) — every sub-screen and modal has one
- Holding a direction repeats after a short delay, like a held keyboard key

Keyboard works everywhere the same actions do (arrows, Enter/Space, Escape),
and a controller-to-keyboard mapper (Steam Input, DS4Windows, etc.) is no
longer required — though one still works fine if you already use one.

There's intentionally nothing clickable that isn't also reachable this way
— the header (player name/icon, clock) is informational only; Settings and
Quit live in the same navigable list as your games. The one gap: typing text
(naming a game, writing a description) still needs a physical keyboard —
there's no on-screen keyboard.

## Building a distributable

```
cd electron
npm run dist:mac    # -> electron/dist/*.dmg, *.zip
npm run dist:win    # -> electron/dist/*.exe (nsis installer + portable)
npm run dist:linux  # -> electron/dist/*.AppImage, *.deb
```

This uses [electron-builder](https://www.electron.build) to produce a real,
self-contained app for the target platform — unlike `Virtual Launcher.app`
(the thin dev-checkout launcher above), the output of `npm run dist:*` runs
on a machine with no copy of this repo. Builds are unsigned, so on another
Mac, Gatekeeper will require a right-click → Open the first time (there's no
Apple Developer certificate involved); on Windows, SmartScreen may show a
similar unrecognized-publisher warning.

## Where your data lives

Your games, settings, and profile live in Electron's standard per-user
app-data directory — the correct place for a real, downloadable app (a
packaged `.app`/`.exe` has no writable project folder of its own to store
things in), not this repo:

| OS | Location |
|---|---|
| macOS | `~/Library/Application Support/virtual-launcher-electron/` |
| Windows | `%APPDATA%\virtual-launcher-electron\` |
| Linux | `~/.config/virtual-launcher-electron/` |

The first time you run the app, it copies `apps.json`/`settings.json`/`user.json`
from the repo root (the pre-packaging layout) into that folder if they're
not there yet — a one-time migration that never touches or deletes the
repo-root originals, which just stay as a frozen snapshot from that point on.

## Files

| Path | What it is |
|---|---|
| `electron/` | The current app — Electron main process (`main.js`), preload bridge, and the renderer (`renderer/`). |
| `electron/assets/`, `electron/build/` | Bundled, read-only assets shipped with the app itself (icons, the app icon) — separate from `assets/` at the repo root, which the app no longer depends on. |
| `Virtual Launcher.app` | Double-click launcher for this checkout (see [Running it](#running-it)). Runs `electron/` in place; not the same as a `dist:*` build. |
| `console_launcher.py` | The original Python/Tkinter prototype. Independent of `electron/`. |
| `apps.json`, `settings.json`, `user.json` | A one-time migration seed for first run (see [Where your data lives](#where-your-data-lives)) — no longer the live data after that. |
| `assets/` | Used by `console_launcher.py` only; the Electron app has its own copy under `electron/assets/`. |
| `pictures/app_icon.png` | The Python launcher's window icon (the Electron app uses `electron/build/icon.png`). |
| `guide/` | Reference UIs used for visual/asset inspiration. Not part of the app; gitignored. |

## Notes

- Icon extraction (showing a real app icon on a tile) only works on macOS
  today; other platforms fall back to a plain letter tile, or SteamGridDB
  art if you set one.
- **SteamGridDB and SteamDB are unrelated services** — easy to conflate
  since the names are so close. This app only uses
  [SteamGridDB](https://www.steamgriddb.com) (a community art database with
  a public API, used here for cover art/icons). SteamDB (a stats/pricing
  tracker) has no public API and isn't used anywhere in this project.
