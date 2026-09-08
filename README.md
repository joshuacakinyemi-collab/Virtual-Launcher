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

**Just want to run the app?** Grab a prebuilt copy from the
**[Releases page](https://github.com/joshuacakinyemi-collab/Virtual-Launcher/releases)**
— pick the file for your OS and see [Installing a prebuilt copy](#installing-a-prebuilt-copy)
below. Those are real, self-contained installs; nothing else in this repo is
required. (`Download/` locally is just where freshly-built copies land before
they get uploaded there — see [Building a distributable](#building-a-distributable) —
it isn't part of the repo itself, so a plain clone won't have it.)

**Working on the code?** Run it from source instead:

```
cd electron
npm install   # first time only
npm start
```

The legacy Python version still runs standalone with no dependencies:

```
python3 console_launcher.py
```

## Installing a prebuilt copy

The [Releases page](https://github.com/joshuacakinyemi-collab/Virtual-Launcher/releases)
has one file per platform:

| File | What it is |
|---|---|
| `Virtual Launcher (macOS, Apple Silicon).dmg` | **Mac install.** Double-click, then drag the app onto the Applications shortcut in the window that opens. |
| `Virtual Launcher (macOS, Apple Silicon).zip` | Same app, zipped instead — unzip it and drag it into `/Applications` yourself. |
| `Virtual Launcher Setup (Windows installer).exe` | **Windows install.** Double-click, it installs to Program Files with a Start Menu shortcut. |
| `Virtual Launcher (Windows portable).exe` | No install — double-click and it just runs, from anywhere (a USB stick, the Desktop, wherever). |
| `Virtual Launcher (Linux x64).AppImage` | Most Linux desktops (Intel/AMD). Make it executable (`chmod +x`) and double-click or run it — no install. |
| `Virtual Launcher (Linux arm64).AppImage` | Same, for ARM-based Linux (Raspberry Pi and similar). |
| `Virtual Launcher (Linux x64).deb` | Debian/Ubuntu install (Intel/AMD) — `sudo dpkg -i` or your package manager's installer. |
| `Virtual Launcher (Linux arm64).deb` | Same, for ARM-based Debian/Ubuntu. |

These are unsigned builds (no Apple Developer certificate / no Windows code-signing
cert), so the first launch will be blocked by the OS until you tell it that's fine:

- **macOS**: a plain double-click only offers "Move to Trash." Instead,
  **right-click (or Control-click) the app → Open → Open** in the dialog.
  After that once, it opens normally forever after.
- **Windows**: SmartScreen shows an "unrecognized publisher" warning →
  **More info → Run anyway**.

## What it does

- **Games sidebar** — every added game, icon + name, always visible on the
  home screen. Select one to open its **detail/Play screen**: cover art,
  description, tags, total playtime, and Play/Cancel.
- **Playtime tracking** — automatic. The launcher hides while a game runs
  and records how long it was open; no manual bookkeeping.
- **Settings** — a wrapping grid, reached via the sidebar's own **Settings**
  entry:
  - **Add Game** — pick any app/executable via a file browser. On macOS and
    Windows its real icon is extracted automatically; optionally search
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
npm run dist:win    # -> electron/dist/*.exe (nsis installer + portable, x64)
npm run dist:linux  # -> electron/dist/*.AppImage, *.deb (x64 and arm64, regardless of host arch)
```

This uses [electron-builder](https://www.electron.build) to produce a real,
self-contained app for the target platform — the output runs on a machine
with no copy of this repo. `electron/build/` holds the source icons
(`icon.icns` for mac, `icon.ico` for Windows, `icon.png` for Linux) that get
embedded into each build.

The Windows target is pinned to `x64` explicitly — left to its own defaults,
electron-builder targets whatever architecture the *build machine* is
running, so building on Apple Silicon would otherwise silently produce a
Windows-on-ARM binary that won't run on a normal (x64) Windows PC.

**Publishing a build:** copy whichever files you want to hand out from
`electron/dist/` into [`Download/`](Download/) (a local staging spot —
gitignored, not part of the repo itself), then upload them as binaries on a
[GitHub Release](https://github.com/joshuacakinyemi-collab/Virtual-Launcher/releases/new).
That's what actually makes them downloadable by anyone — unlike the repo's
tracked files, Release assets live outside git history, so shipping a new
80–100MB build never bloats a future clone. Committing the raw files to git
instead (even un-gitignoring `Download/`) would do exactly that.

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
| `electron/assets/`, `electron/build/` | Bundled, read-only assets shipped with the app itself (UI icons, the app icon in every format each platform's packager wants) — separate from `assets/` at the repo root, which the app no longer depends on. |
| `Download/` | Local staging spot for build output before it's uploaded to a [GitHub Release](https://github.com/joshuacakinyemi-collab/Virtual-Launcher/releases) — that's where end users actually get it (see [Installing a prebuilt copy](#installing-a-prebuilt-copy)). Gitignored; not part of the repo itself. |
| `console_launcher.py` | The original Python/Tkinter prototype. Independent of `electron/`. |
| `apps.json`, `settings.json`, `user.json` | A one-time migration seed for first run (see [Where your data lives](#where-your-data-lives)) — no longer the live data after that. |
| `assets/` | Used by `console_launcher.py` only; the Electron app has its own copy under `electron/assets/`. |
| `pictures/app_icon.png` | The Python launcher's window icon (the Electron app uses `electron/build/icon.png`). |
| `guide/` | Reference UIs used for visual/asset inspiration. Not part of the app; gitignored. |

## Notes

- Icon extraction (showing a real app icon on a tile) works on macOS
  (`.icns` via `sips`/`plutil`) and Windows (pulling the icon straight out
  of the `.exe` via a PowerShell one-liner). Linux falls back to a plain
  letter tile, or SteamGridDB art if you set one — there's no single
  cross-distro convention for it the way there is on the other two.
- **SteamGridDB and SteamDB are unrelated services** — easy to conflate
  since the names are so close. This app only uses
  [SteamGridDB](https://www.steamgriddb.com) (a community art database with
  a public API, used here for cover art/icons). SteamDB (a stats/pricing
  tracker) has no public API and isn't used anywhere in this project.
