const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync, execFile } = require('child_process');

// Bundled, read-only assets — shipped inside the app itself, same in dev
// and in a packaged build, so these stay relative to this file rather than
// the (dev-only) repo root.
const ASSETS_DIR = path.join(__dirname, 'assets');
const APP_ICON_PATH = path.join(__dirname, 'build', 'icon.png');

// Per-user data (games, settings, profile, cached icons) lives in Electron's
// standard per-OS app-data directory — required for a packaged/downloadable
// build, since a packaged app has no writable "repo root" of its own, and
// it's the correct place for this regardless (matches how the SteamGridDB
// key was already stored). Computed lazily, not as a top-level const, since
// app.getPath() wants the app past its 'ready' checks in some Electron
// versions — every call site already only runs from an IPC handler or
// app.whenReady(), so laziness costs nothing.
function userDataDir() {
  return app.getPath('userData');
}
function appsPath() {
  return path.join(userDataDir(), 'apps.json');
}
function settingsPath() {
  return path.join(userDataDir(), 'settings.json');
}
function userJsonPath() {
  return path.join(userDataDir(), 'user.json');
}
function iconCacheDir() {
  return path.join(userDataDir(), 'app_icons');
}
function fontsDir() {
  return path.join(userDataDir(), 'fonts');
}
function musicDir() {
  return path.join(userDataDir(), 'music');
}
function uiSoundsDir() {
  return path.join(userDataDir(), 'ui_sounds');
}
// Each kind gets its own subfolder rather than one shared dir — keeps
// same-named imports for different kinds (e.g. two different "blip.wav"
// files, one picked for Move and one for Confirm) from colliding.
function uiSoundKindDir(kind) {
  return path.join(uiSoundsDir(), kind);
}

const UI_SOUND_KINDS = ['move', 'confirm', 'back'];

// Shared by every "imported file" list this app keeps (fonts, background
// music, per-kind menu sounds) — each of those used to hand-roll the same
// dedupe-by-bytes-and-pick-a-unique-name logic, and the same
// select-by-fileName / remove-by-fileName logic, once per list. `fileName`
// in all three helpers ultimately comes from settings.json (a stored
// list entry, or an IPC argument echoing one back) rather than fresh user
// input, so isSafeFileName guards against a hand-edited or corrupted
// settings file pointing outside its own managed directory.
function isSafeFileName(name) {
  return typeof name === 'string' && name.length > 0
    && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..';
}

// Copies srcPath into dir, reusing an existing list entry if the bytes
// already match one instead of piling up duplicate entries for the same
// file. A cheap size comparison runs before any full read, since two
// different files almost always differ in size — the common case never
// pays for reading a candidate's full bytes just to rule it out. Returns
// the resolved {fileName, displayName, list} (list is `existingList`
// unchanged when reusing a duplicate, or with the new entry appended).
function importDedupedFile(dir, srcPath, existingList, { fallbackBase, defaultExt }) {
  const ext = path.extname(srcPath) || defaultExt;
  const displayName = path.basename(srcPath, path.extname(srcPath)) || fallbackBase;
  const safeBase = displayName.replace(/[^A-Za-z0-9_-]+/g, '_') || fallbackBase;

  fs.mkdirSync(dir, { recursive: true });
  const srcSize = fs.statSync(srcPath).size;
  const srcBuf = fs.readFileSync(srcPath);
  const duplicate = existingList.find((f) => {
    try {
      const candidatePath = path.join(dir, f.fileName);
      if (fs.statSync(candidatePath).size !== srcSize) return false;
      return fs.readFileSync(candidatePath).equals(srcBuf);
    } catch {
      return false;
    }
  });

  let fileName;
  if (duplicate) {
    fileName = duplicate.fileName;
  } else {
    fileName = `${safeBase}${ext}`;
    let counter = 2;
    while (fs.existsSync(path.join(dir, fileName))) {
      fileName = `${safeBase}_${counter}${ext}`;
      counter += 1;
    }
    fs.writeFileSync(path.join(dir, fileName), srcBuf);
  }

  const list = duplicate ? existingList : [...existingList, { fileName, displayName }];
  return { fileName, displayName, list };
}

// Resolves a previously-imported file's stored fileName back to its full
// path, or null if it's missing from the list or looks unsafe.
function selectStoredFile(dir, list, fileName) {
  if (!isSafeFileName(fileName)) return null;
  if (!list.some((f) => f.fileName === fileName)) return null;
  return path.join(dir, fileName);
}

// Deletes one imported file (best-effort) and returns the list with its
// entry removed, plus whether it was actually present.
function removeStoredFile(dir, list, fileName) {
  if (!isSafeFileName(fileName)) return { list, removed: false };
  const removed = list.some((f) => f.fileName === fileName);
  if (removed) {
    try { fs.unlinkSync(path.join(dir, fileName)); } catch { /* already gone */ }
  }
  return { list: list.filter((f) => f.fileName !== fileName), removed };
}

// One-time migration from this project's old pre-packaging layout (data
// files sitting next to the repo). Safe to call every launch: it only ever
// copies when the new location doesn't have the file yet, and it never
// deletes the old files — they're left in place as a frozen snapshot.
function migrateLegacyDataIfNeeded() {
  const legacyRoot = path.join(__dirname, '..');
  const moves = [
    [path.join(legacyRoot, 'apps.json'), appsPath()],
    [path.join(legacyRoot, 'settings.json'), settingsPath()],
    [path.join(legacyRoot, 'user.json'), userJsonPath()],
  ];
  fs.mkdirSync(userDataDir(), { recursive: true });
  for (const [oldPath, newPath] of moves) {
    if (fs.existsSync(newPath) || !fs.existsSync(oldPath)) continue;
    try {
      fs.copyFileSync(oldPath, newPath);
    } catch {
      // best-effort — a fresh file is created normally on first save either way
    }
  }
}

const TIMEZONES = [
  'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Africa/Cairo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo',
  'Australia/Sydney', 'Pacific/Auckland',
];

const DEFAULT_THEME_COLOR = '#2f8fe0';
const WINDOW_W = 960;
const WINDOW_H = 600;

let mainWindow = null;

function slugFor(p) {
  const digest = crypto.createHash('sha1').update(p).digest('hex').slice(0, 10);
  const base = path.basename(p.replace(/\/+$/, '')).replace(/[^A-Za-z0-9_-]+/g, '_');
  return `${base}_${digest}`;
}

function loadApps() {
  if (!fs.existsSync(appsPath())) return [];
  try {
    const data = JSON.parse(fs.readFileSync(appsPath(), 'utf8'));
    return (data.apps || []).map((item) => ({
      name: item.name || '',
      path: item.path || '',
      iconPath: item.icon_path || null,
      // banner_path is the current field name; art_path is read for
      // backward compatibility with apps.json files saved before the
      // icon/banner split. grid_path is separate from both — SteamGridDB's
      // own "Grid" cover art, distinct from the wide banner (Hero) image.
      bannerPath: item.banner_path || item.art_path || null,
      gridPath: item.grid_path || null,
      playtimeSeconds: Number.isFinite(item.playtime_seconds) ? item.playtime_seconds : 0,
      slug: slugFor(item.path || ''),
    }));
  } catch {
    return [];
  }
}

function saveApps(apps) {
  const data = {
    apps: apps.map((a) => ({
      name: a.name,
      path: a.path,
      icon_path: a.iconPath || null,
      banner_path: a.bannerPath || null,
      grid_path: a.gridPath || null,
      playtime_seconds: a.playtimeSeconds || 0,
    })),
  };
  fs.writeFileSync(appsPath(), JSON.stringify(data, null, 2));
}

// SteamGridDB API key: kept alongside the rest of per-user data, but in its
// own file rather than settings.json — it's a secret, not a display
// preference.
function steamGridDbConfigPath() {
  return path.join(userDataDir(), 'steamgriddb.json');
}

function loadSteamGridDbKey() {
  try {
    const data = JSON.parse(fs.readFileSync(steamGridDbConfigPath(), 'utf8'));
    return typeof data.apiKey === 'string' ? data.apiKey : '';
  } catch {
    return '';
  }
}

function saveSteamGridDbKey(key) {
  fs.writeFileSync(steamGridDbConfigPath(), JSON.stringify({ apiKey: key }, null, 2));
}

function loadRawSettings() {
  if (!fs.existsSync(settingsPath())) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

// Merges into the existing file rather than overwriting it — settings.json
// holds both theme fields (written by the Menu Color screen) and display
// fields (font/timezone, written by the Font/Time screens); a plain
// overwrite from either screen would silently erase the other's fields.
function writeRawSettings(partial) {
  const current = loadRawSettings();
  fs.writeFileSync(settingsPath(), JSON.stringify({ ...current, ...partial }, null, 2));
}

function loadSettings() {
  const data = loadRawSettings();
  const themeColor = data.theme_color || DEFAULT_THEME_COLOR;
  let customFonts = Array.isArray(data.custom_fonts)
    ? data.custom_fonts
      // isSafeFileName guards select-font/remove-font against a corrupted
      // or hand-edited settings.json pointing outside fontsDir(); the
      // existsSync check drops "ghost" entries whose backing file was
      // deleted out from under the app, so a Change Font row always
      // matches something that's actually still there to select.
      .filter((f) => f && typeof f.fileName === 'string' && typeof f.displayName === 'string'
        && isSafeFileName(f.fileName) && fs.existsSync(path.join(fontsDir(), f.fileName)))
      // Each font remembers its own scale — different font files render at
      // very different apparent sizes for the same CSS font-size (their
      // own internal glyph proportions differ), so one global size setting
      // can never make every imported font look right at once.
      .map((f) => ({ ...f, scale: Number.isFinite(f.scale) ? Math.max(0.7, Math.min(2, f.scale)) : 1 }))
    : [];
  const fontPath = typeof data.font_path === 'string' ? data.font_path : null;

  // Back-fills a list entry for a font_path that predates custom_fonts
  // (set by an older build, or before this list existed at all) — without
  // this, an already-active font would silently have no row to reselect
  // it from, as if it had never been imported. Only for paths already
  // inside fontsDir(): select-font reactivates an entry by joining
  // fontsDir() with its fileName, so backfilling an *external* path here
  // (a pre-copy-feature reference living elsewhere) would silently break
  // the moment it's reselected, pointing at a file that was never there.
  if (fontPath && path.dirname(fontPath) === fontsDir() && fs.existsSync(fontPath)) {
    const fileName = path.basename(fontPath);
    if (!customFonts.some((f) => f.fileName === fileName)) {
      const displayName = path.basename(fontPath, path.extname(fontPath));
      customFonts = [...customFonts, { fileName, displayName }];
      writeRawSettings({ custom_fonts: customFonts });
    }
  }

  // Every track ever imported stays listed (custom_music), same as
  // custom_fonts — Change Music offers a "pick from what's already been
  // imported" list instead of forcing another trip through the file
  // browser every time you want to switch back to one you used before.
  let customMusic = Array.isArray(data.custom_music)
    ? data.custom_music.filter((f) => f && typeof f.fileName === 'string' && typeof f.displayName === 'string'
      && isSafeFileName(f.fileName) && fs.existsSync(path.join(musicDir(), f.fileName)))
    : [];
  const musicPath = typeof data.music_path === 'string' && fs.existsSync(data.music_path) ? data.music_path : null;

  if (musicPath && path.dirname(musicPath) === musicDir() && fs.existsSync(musicPath)) {
    const fileName = path.basename(musicPath);
    if (!customMusic.some((f) => f.fileName === fileName)) {
      const displayName = path.basename(musicPath, path.extname(musicPath));
      customMusic = [...customMusic, { fileName, displayName }];
      writeRawSettings({ custom_music: customMusic });
    }
  }

  // Every sound ever imported for a kind stays listed (custom_ui_sounds),
  // same reasoning as custom_fonts/custom_music — Menu Sounds offers a
  // "pick from what's already been imported" list per kind instead of
  // forcing another trip through the file browser every time.
  const uiSounds = {};
  const customUiSounds = {};
  let customUiSoundsChanged = false;
  const rawCustomUiSounds = data.custom_ui_sounds && typeof data.custom_ui_sounds === 'object' ? data.custom_ui_sounds : {};
  for (const kind of UI_SOUND_KINDS) {
    let list = Array.isArray(rawCustomUiSounds[kind])
      ? rawCustomUiSounds[kind].filter((f) => f && typeof f.fileName === 'string' && typeof f.displayName === 'string'
        && isSafeFileName(f.fileName) && fs.existsSync(path.join(uiSoundKindDir(kind), f.fileName)))
      : [];
    const activePath = typeof data[`ui_sound_${kind}`] === 'string' && fs.existsSync(data[`ui_sound_${kind}`]) ? data[`ui_sound_${kind}`] : null;
    if (activePath && path.dirname(activePath) === uiSoundKindDir(kind)) {
      const fileName = path.basename(activePath);
      if (!list.some((f) => f.fileName === fileName)) {
        list = [...list, { fileName, displayName: path.basename(activePath, path.extname(activePath)) }];
        customUiSoundsChanged = true;
      }
    }
    uiSounds[kind] = activePath;
    customUiSounds[kind] = list;
  }
  if (customUiSoundsChanged) writeRawSettings({ custom_ui_sounds: customUiSounds });

  return {
    themeColor,
    fontPath,
    fontFamily: typeof data.font_family === 'string' ? data.font_family : null,
    fontSize: ['small', 'medium', 'large'].includes(data.font_size) ? data.font_size : 'medium',
    customFonts,
    timezone: typeof data.timezone === 'string' ? data.timezone : null,
    timeFormat: data.time_format === '12h' ? '12h' : '24h',
    showSeconds: data.show_seconds === true,
    themeMode: data.theme_mode === 'light' ? 'light' : 'dark',
    musicPath,
    musicVolume: Number.isFinite(data.music_volume) ? Math.max(0, Math.min(1, data.music_volume)) : 0.5,
    musicMuted: data.music_muted === true,
    customMusic,
    uiSounds,
    customUiSounds,
  };
}

// A single accent color is the only thing a user sets directly — glow/tile
// are always derived from it (Theme.computeTheme in the renderer), so the
// palette can't drift into a mismatched combination the way independently
// overriding glow/tile used to allow. themeMode (dark/light) picks which
// neutral base that derivation starts from.
function saveSettings(themeColor, themeMode) {
  writeRawSettings({ theme_color: themeColor, theme_mode: themeMode === 'light' ? 'light' : 'dark' });
}

function saveDisplaySettings({ fontPath, fontFamily, fontSize, timezone, timeFormat, showSeconds }) {
  writeRawSettings({
    font_path: fontPath || null,
    font_family: fontFamily || null,
    font_size: fontSize || 'medium',
    timezone: timezone || null,
    time_format: timeFormat === '12h' ? '12h' : '24h',
    show_seconds: showSeconds === true,
  });
}

function loadUser() {
  if (!fs.existsSync(userJsonPath())) return { name: 'Player', iconPath: null };
  try {
    const data = JSON.parse(fs.readFileSync(userJsonPath(), 'utf8'));
    return { name: typeof data.name === 'string' && data.name ? data.name : 'Player', iconPath: data.icon_path || null };
  } catch {
    return { name: 'Player', iconPath: null };
  }
}

function saveUser(user) {
  fs.writeFileSync(userJsonPath(), JSON.stringify({ name: user.name, icon_path: user.iconPath || null }, null, 2));
}

function defaultAppDir() {
  if (process.platform === 'darwin') return '/Applications';
  if (process.platform === 'win32') return process.env.ProgramFiles || 'C:\\';
  return os.homedir();
}

function extractAppIcon(appPath) {
  if (process.platform === 'darwin') return extractAppIconMac(appPath);
  if (process.platform === 'win32') return extractAppIconWindows(appPath);
  return null;
}

function extractAppIconMac(appPath) {
  if (!appPath.endsWith('.app')) return null;

  const resourcesDir = path.join(appPath, 'Contents', 'Resources');
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  let icnsPath = null;

  if (fs.existsSync(plistPath)) {
    try {
      const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8' });
      const info = JSON.parse(json);
      let iconFile = info.CFBundleIconFile;
      if (iconFile) {
        if (!iconFile.endsWith('.icns')) iconFile += '.icns';
        const candidate = path.join(resourcesDir, iconFile);
        if (fs.existsSync(candidate)) icnsPath = candidate;
      }
    } catch {
      // fall through to directory scan
    }
  }

  if (!icnsPath && fs.existsSync(resourcesDir)) {
    const match = fs.readdirSync(resourcesDir).find((f) => f.toLowerCase().endsWith('.icns'));
    if (match) icnsPath = path.join(resourcesDir, match);
  }

  if (!icnsPath) return null;

  fs.mkdirSync(iconCacheDir(), { recursive: true });
  const destPath = path.join(iconCacheDir(), `${slugFor(appPath)}.png`);
  try {
    execFileSync('sips', ['-s', 'format', 'png', icnsPath, '--out', destPath], { stdio: 'ignore' });
  } catch {
    return null;
  }
  return fs.existsSync(destPath) ? destPath : null;
}

// Windows .exe icons are a PE resource embedded in the file itself — no
// bundle/plist step like macOS needs, but there's still no plain file read
// that returns it as an image; it has to go through a Windows API. Rather
// than adding a native dependency, this shells out to PowerShell (present
// on every supported Windows version) via .NET's System.Drawing, the same
// way the mac path shells out to sips/plutil instead of a native binding.
function extractAppIconWindows(exePath) {
  if (!exePath.toLowerCase().endsWith('.exe')) return null;

  fs.mkdirSync(iconCacheDir(), { recursive: true });
  const destPath = path.join(iconCacheDir(), `${slugFor(exePath)}.png`);
  const psEscape = (s) => s.replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    `$icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${psEscape(exePath)}')`,
    'if ($null -eq $icon) { exit 1 }',
    '$bitmap = $icon.ToBitmap()',
    `$bitmap.Save('${psEscape(destPath)}', [System.Drawing.Imaging.ImageFormat]::Png)`,
  ].join('; ');

  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' });
  } catch {
    return null;
  }
  return fs.existsSync(destPath) ? destPath : null;
}

function createWindow() {
  // Matches the theme mode's own base tone so the window's native
  // background (visible for a frame before the page paints) doesn't flash
  // black-then-white on a light-mode profile.
  const startupBg = loadSettings().themeMode === 'light' ? '#eef1f6' : '#000000';
  mainWindow = new BrowserWindow({
    width: WINDOW_W,
    height: WINDOW_H,
    minWidth: 640,
    minHeight: 420,
    center: true,
    resizable: true,
    fullscreen: true,
    icon: APP_ICON_PATH,
    backgroundColor: startupBg,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Without this, Chromium's default autoplay policy blocks the
      // background music track from starting until the user has clicked
      // something — this is the app's own launcher chrome, not a random
      // website, so that restriction only gets in the way.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  migrateLegacyDataIfNeeded();
  if (process.platform === 'darwin' && app.dock && fs.existsSync(APP_ICON_PATH)) {
    app.dock.setIcon(APP_ICON_PATH);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-state', () => {
  const { themeColor, themeMode, fontPath, fontFamily, fontSize, customFonts, timezone, timeFormat, showSeconds, musicPath, musicVolume, musicMuted, customMusic, uiSounds, customUiSounds } = loadSettings();
  return {
    apps: loadApps(),
    user: loadUser(),
    themeColor,
    themeMode,
    fontPath,
    fontFamily,
    fontSize,
    customFonts,
    timezone,
    timeFormat,
    showSeconds,
    musicPath,
    musicVolume,
    musicMuted,
    customMusic,
    uiSounds,
    customUiSounds,
    timezones: TIMEZONES,
    assetsDir: ASSETS_DIR,
  };
});

ipcMain.handle('choose-app-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an application to add',
    defaultPath: defaultAppDir(),
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('choose-image-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Copies the picked font file into the app's own data directory rather than
// referencing it in place — otherwise the custom font silently breaks the
// next time the original file gets moved, renamed, or deleted, since
// nothing about picking it keeps that original path alive. Every distinct
// font imported is kept (not just the currently active one) and recorded
// in custom_fonts, so Change Font can offer a "pick from what you've
// already imported" list instead of forcing another trip through the file
// browser every time.
ipcMain.handle('choose-font-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a font',
    properties: ['openFile'],
    filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const settings = loadSettings();
  const { fileName, displayName, list: customFonts } = importDedupedFile(
    fontsDir(), result.filePaths[0], settings.customFonts, { fallbackBase: 'Custom Font', defaultExt: '.ttf' },
  );
  const destPath = path.join(fontsDir(), fileName);
  writeRawSettings({ custom_fonts: customFonts, font_path: destPath, font_family: 'CustomUserFont' });
  return { path: destPath, fileName, displayName, customFonts };
});

// Activates a previously-imported font by its stored fileName — no file
// browser involved, since it's already sitting in fontsDir().
ipcMain.handle('select-font', (_event, fileName) => {
  const settings = loadSettings();
  const destPath = selectStoredFile(fontsDir(), settings.customFonts, fileName);
  if (!destPath) return loadSettings();
  writeRawSettings({ font_path: destPath, font_family: 'CustomUserFont' });
  return loadSettings();
});

// Updates one font's own remembered scale (0.7-2.0) — not a global
// setting, since different font files need different scales to look
// consistent with the rest of the UI at the same nominal text size.
ipcMain.handle('set-font-scale', (_event, { fileName, scale }) => {
  const settings = loadSettings();
  const clamped = Math.max(0.7, Math.min(2, Number(scale) || 1));
  const customFonts = settings.customFonts.map((f) => (f.fileName === fileName ? { ...f, scale: clamped } : f));
  writeRawSettings({ custom_fonts: customFonts });
  return loadSettings();
});

// Removes a stored font (the file and its entry in custom_fonts). If it
// was the active one, falls back to the default font.
ipcMain.handle('remove-font', (_event, fileName) => {
  const settings = loadSettings();
  const wasActive = settings.fontPath === path.join(fontsDir(), fileName);
  const { list: customFonts } = removeStoredFile(fontsDir(), settings.customFonts, fileName);
  writeRawSettings({
    custom_fonts: customFonts,
    ...(wasActive ? { font_path: null, font_family: null } : {}),
  });
  return loadSettings();
});

// Copies the picked audio file into the app's own data directory rather
// than referencing it in place (same reasoning as choose-font-path: a
// path into the user's own filesystem silently breaks the moment that
// original file gets moved, renamed, or deleted). Every distinct track
// imported is kept (not just the active one) and recorded in
// custom_music, so Background Music can offer a "pick from what you've
// already imported" list instead of forcing another trip through the
// file browser every time.
ipcMain.handle('choose-music-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose background music',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return loadSettings();
  const settings = loadSettings();
  const { fileName, list: customMusic } = importDedupedFile(
    musicDir(), result.filePaths[0], settings.customMusic, { fallbackBase: 'Background Music', defaultExt: '.mp3' },
  );
  writeRawSettings({ custom_music: customMusic, music_path: path.join(musicDir(), fileName) });
  return loadSettings();
});

// Activates a previously-imported track by its stored fileName — no file
// browser involved, since it's already sitting in musicDir().
ipcMain.handle('select-music', (_event, fileName) => {
  const settings = loadSettings();
  const destPath = selectStoredFile(musicDir(), settings.customMusic, fileName);
  if (!destPath) return loadSettings();
  writeRawSettings({ music_path: destPath });
  return loadSettings();
});

// Removes a stored track (the file and its entry in custom_music). If it
// was the active one, falls back to silence.
ipcMain.handle('remove-music', (_event, fileName) => {
  const settings = loadSettings();
  const wasActive = settings.musicPath === path.join(musicDir(), fileName);
  const { list: customMusic } = removeStoredFile(musicDir(), settings.customMusic, fileName);
  writeRawSettings({
    custom_music: customMusic,
    ...(wasActive ? { music_path: null } : {}),
  });
  return loadSettings();
});

ipcMain.handle('set-music-volume', (_event, volume) => {
  const clamped = Math.max(0, Math.min(1, Number(volume)));
  writeRawSettings({ music_volume: Number.isFinite(clamped) ? clamped : 0.5 });
  return loadSettings();
});

ipcMain.handle('set-music-muted', (_event, muted) => {
  writeRawSettings({ music_muted: muted === true });
  return loadSettings();
});

// Copies the picked audio file into this kind's own subfolder rather than
// referencing it in place (same reasoning as choose-font-path/
// choose-music-path). Every distinct sound imported for a kind is kept
// (not just the active one) and recorded in custom_ui_sounds, so Menu
// Sounds can offer a "pick from what's already been imported" list per
// kind instead of forcing another trip through the file browser every time.
ipcMain.handle('choose-ui-sound', async (_event, kind) => {
  if (!UI_SOUND_KINDS.includes(kind)) return loadSettings();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Choose a ${kind} sound`,
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return loadSettings();
  const settings = loadSettings();
  const dir = uiSoundKindDir(kind);
  const { fileName, list } = importDedupedFile(
    dir, result.filePaths[0], settings.customUiSounds[kind], { fallbackBase: `${kind} sound`, defaultExt: '.mp3' },
  );
  const customUiSounds = { ...settings.customUiSounds, [kind]: list };
  writeRawSettings({ custom_ui_sounds: customUiSounds, [`ui_sound_${kind}`]: path.join(dir, fileName) });
  return loadSettings();
});

// Activates a previously-imported sound for this kind by its fileName —
// no file browser involved, since it's already sitting in its subfolder.
ipcMain.handle('select-ui-sound', (_event, { kind, fileName }) => {
  if (!UI_SOUND_KINDS.includes(kind)) return loadSettings();
  const settings = loadSettings();
  const destPath = selectStoredFile(uiSoundKindDir(kind), settings.customUiSounds[kind], fileName);
  if (!destPath) return loadSettings();
  writeRawSettings({ [`ui_sound_${kind}`]: destPath });
  return loadSettings();
});

// Reverts one kind back to its built-in synthesized tone, without
// deleting anything already imported for it (distinct from remove-ui-sound
// below, which deletes a specific imported file).
ipcMain.handle('clear-ui-sound', (_event, kind) => {
  if (!UI_SOUND_KINDS.includes(kind)) return loadSettings();
  writeRawSettings({ [`ui_sound_${kind}`]: null });
  return loadSettings();
});

// Removes one imported sound (the file and its custom_ui_sounds entry).
// If it was the active one, falls back to the built-in synthesized tone.
ipcMain.handle('remove-ui-sound', (_event, { kind, fileName }) => {
  if (!UI_SOUND_KINDS.includes(kind)) return loadSettings();
  const settings = loadSettings();
  const dir = uiSoundKindDir(kind);
  const wasActive = settings.uiSounds[kind] === path.join(dir, fileName);
  const { list } = removeStoredFile(dir, settings.customUiSounds[kind], fileName);
  const customUiSounds = { ...settings.customUiSounds, [kind]: list };
  writeRawSettings({
    custom_ui_sounds: customUiSounds,
    ...(wasActive ? { [`ui_sound_${kind}`]: null } : {}),
  });
  return loadSettings();
});

ipcMain.handle('add-app', (_event, { name, path: appPath, iconPath, bannerPath, gridPath }) => {
  const apps = loadApps();
  // An explicitly picked icon (SteamGridDB search or a local file, chosen
  // during Add Game) wins; otherwise fall back to OS icon extraction, same
  // as before this had its own icon-picking step.
  const resolvedIconPath = iconPath || extractAppIcon(appPath);
  apps.push({
    name, path: appPath, iconPath: resolvedIconPath, bannerPath: bannerPath || null, gridPath: gridPath || null,
    playtimeSeconds: 0, slug: slugFor(appPath),
  });
  saveApps(apps);
  return loadApps();
});

ipcMain.handle('update-app', (_event, { slug, name, iconPath, bannerPath, gridPath }) => {
  const apps = loadApps();
  const entry = apps.find((a) => a.slug === slug);
  if (!entry) return loadApps();
  if (typeof name === 'string' && name) entry.name = name;
  if (iconPath !== undefined) entry.iconPath = iconPath;
  if (bannerPath !== undefined) entry.bannerPath = bannerPath;
  if (gridPath !== undefined) entry.gridPath = gridPath;
  saveApps(apps);
  return loadApps();
});

ipcMain.handle('remove-app', (_event, slug) => {
  const apps = loadApps();
  const entry = apps.find((a) => a.slug === slug);
  const remaining = apps.filter((a) => a.slug !== slug);
  for (const cachedPath of [entry?.iconPath, entry?.bannerPath, entry?.gridPath]) {
    if (cachedPath && path.dirname(cachedPath) === iconCacheDir()) {
      try {
        fs.unlinkSync(cachedPath);
      } catch {
        // already gone
      }
    }
  }
  saveApps(remaining);
  return loadApps();
});

ipcMain.handle('save-settings', (_event, { themeColor, themeMode }) => {
  saveSettings(themeColor, themeMode);
  return true;
});

ipcMain.handle('save-display-settings', (_event, payload) => {
  saveDisplaySettings(payload);
  return true;
});

ipcMain.handle('update-user', (_event, { name, iconPath }) => {
  const current = loadUser();
  const next = {
    name: typeof name === 'string' && name ? name : current.name,
    iconPath: iconPath !== undefined ? iconPath : current.iconPath,
  };
  saveUser(next);
  return next;
});

// Some Windows games ship a small bootstrap .exe that launches the real
// game executable and quits itself within a second or two — plain
// spawn() only ever tracks that bootstrap, so its 'exit' fires while the
// real game is just starting, and the launcher would reshow itself (and
// resume background music) mid-relaunch instead of when the game is
// actually done.
//
// This used to detect a relaunch by checking whether anything was still
// running out of the launched app's own install folder, but that breaks
// two ways: a real game whose actual executable lives in a *different*
// folder than the one the user pointed Virtual Launcher at (common —
// stub launchers routinely live in Program Files while the real game
// runs from an entirely separate install/library location) is invisible
// to it, and an unrelated process merely sharing the folder name (fixed
// once, but a sign the whole approach is fragile) can false-positive.
// Tracking actual process IDs instead of paths has neither problem: a PID
// snapshot taken right after launch, diffed against a fresh snapshot the
// moment the bootstrap exits, finds whatever new process(es) appeared
// during the launch — wherever they happen to live on disk — and reshow
// waits for those specific PIDs to clear instead.
//
// Bounded and best-effort throughout: any PowerShell failure just falls
// back to immediate reshow, and PIDs that never clear (e.g. a lingering
// background service) time out after RELAUNCH_MAX_WAIT_MS rather than
// wedging the launcher shut forever.
const RELAUNCH_RECHECK_MS = 500;
const RELAUNCH_POLL_MS = 4000;
const RELAUNCH_MAX_WAIT_MS = 10 * 60 * 1000;

function listRunningPids() {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', "(Get-Process -ErrorAction SilentlyContinue).Id -join ','"], { encoding: 'utf8' }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const ids = String(stdout).trim().split(',').map((s) => parseInt(s, 10)).filter(Number.isFinite);
      resolve(new Set(ids));
    });
  });
}

function anyPidsRunning(pids) {
  return new Promise((resolve) => {
    if (!pids.length) { resolve(false); return; }
    const script = `(Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue).Count`;
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }, (err, stdout) => {
      resolve(!err && parseInt(String(stdout).trim(), 10) > 0);
    });
  });
}

async function waitForRelaunchToClear(basePids, done) {
  if (!basePids) { done(); return; }
  const newSincePids = async () => {
    const postPids = await listRunningPids();
    if (!postPids) return [];
    return [...postPids].filter((pid) => !basePids.has(pid));
  };

  let newPids = await newSincePids();
  if (!newPids.length) {
    // The real game's process can appear a beat after the bootstrap's own
    // exit event fires — one short recheck absorbs that race without
    // adding a fixed delay to the (usual) case where nothing relaunches.
    await new Promise((resolve) => setTimeout(resolve, RELAUNCH_RECHECK_MS));
    newPids = await newSincePids();
  }
  if (!newPids.length) { done(); return; }

  const deadline = Date.now() + RELAUNCH_MAX_WAIT_MS;
  const check = async () => {
    if (Date.now() > deadline || !(await anyPidsRunning(newPids))) { done(); return; }
    setTimeout(check, RELAUNCH_POLL_MS);
  };
  check();
}

ipcMain.handle('launch-app', (_event, appPath) => {
  if (!appPath || !fs.existsSync(appPath)) {
    return { ok: false, error: `This app could not be found:\n${appPath}` };
  }
  // Minimize (not hide) while the game runs: a minimized window still has a
  // real Dock thumbnail the user can click at any time, so the launcher is
  // always reachable even if the launched app lingers in the background
  // (e.g. an app that keeps running after its window closes) and never
  // fires the exit event below.
  mainWindow.minimize();
  const startedAt = Date.now();
  const child = process.platform === 'darwin' ? spawn('open', ['-W', appPath]) : spawn(appPath, []);
  // Kicked off now (not awaited here) so it's already resolved — or close
  // to it — by the time 'exit' fires, rather than only starting the
  // lookup after the bootstrap has already quit.
  const basePidsPromise = process.platform === 'win32' ? listRunningPids() : null;
  const reshow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      // Tells the renderer the launched app is done, independent of the
      // playtime-tracking send below (which only fires when the launched
      // path still matches a saved game) — background music resumes on
      // this event regardless of whether that entry lookup succeeds.
      mainWindow.webContents.send('game-exited');
    }
    // Playtime is recorded on exit, after the launchApp promise below has
    // already resolved (the game was just launched, not yet closed) — the
    // renderer can't learn about it from a return value, so it's pushed.
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    const apps = loadApps();
    const entry = apps.find((a) => a.path === appPath);
    if (entry) {
      entry.playtimeSeconds = (entry.playtimeSeconds || 0) + elapsedSeconds;
      saveApps(apps);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('apps-updated', loadApps());
      }
    }
  };
  child.on('exit', () => {
    if (basePidsPromise) basePidsPromise.then((basePids) => waitForRelaunchToClear(basePids, reshow));
    else reshow();
  });
  child.on('error', reshow);
  return { ok: true };
});

ipcMain.handle('quit', () => {
  app.quit();
});

ipcMain.handle('steamgriddb-get-key', () => loadSteamGridDbKey());

ipcMain.handle('steamgriddb-save-key', (_event, key) => {
  saveSteamGridDbKey((key || '').trim());
  return true;
});

const STEAMGRIDDB_BASE = 'https://www.steamgriddb.com/api/v2';

ipcMain.handle('steamgriddb-search', async (_event, term) => {
  const key = loadSteamGridDbKey();
  if (!key) return { ok: false, error: 'No SteamGridDB API key set.' };
  try {
    const res = await fetch(`${STEAMGRIDDB_BASE}/search/autocomplete/${encodeURIComponent(term)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await res.json();
    if (!res.ok || !json.success) return { ok: false, error: 'SteamGridDB search failed.' };
    return { ok: true, results: (json.data || []).slice(0, 5).map((g) => ({ id: g.id, name: g.name })) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Art listings come back a page at a time (the API's `page` param,
// 0-based). Every result on the page is returned — the picker used to cut
// this to the first 9 — and `hasMore` tells the picker whether to offer
// "Load more". width/height/mime ride along so the picker can label each
// option and play animated ones (whose thumb is a video, not an image).
async function fetchSteamGridDbArt(kindPath, gameId, page, errorMessage) {
  const key = loadSteamGridDbKey();
  if (!key) return { ok: false, error: 'No SteamGridDB API key set.' };
  try {
    const res = await fetch(`${STEAMGRIDDB_BASE}/${kindPath}/game/${gameId}?page=${page}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await res.json();
    if (!res.ok || !json.success) return { ok: false, error: errorMessage };
    const data = json.data || [];
    const pageSize = json.limit || 50;
    const hasMore = Number.isFinite(json.total)
      ? (page + 1) * pageSize < json.total
      : data.length >= pageSize;
    return {
      ok: true,
      hasMore,
      grids: data.map((g) => ({ id: g.id, url: g.url, thumb: g.thumb, width: g.width, height: g.height, mime: g.mime })),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// SteamGridDB's actual "Grid" asset — Steam's own library cover art
// (traditionally the tall 600x900 capsule, though some games also have
// landscape-style grids). This is its own distinct picture now (not a
// stand-in for the banner), so no dimension bias — offer whatever SteamGridDB
// actually has.
ipcMain.handle('steamgriddb-grids', (_event, gameId, page = 0) =>
  fetchSteamGridDbArt('grids', gameId, page, 'Could not fetch SteamGridDB grid art.'));

ipcMain.handle('steamgriddb-icons', (_event, gameId, page = 0) =>
  fetchSteamGridDbArt('icons', gameId, page, 'Could not fetch SteamGridDB icons.'));

// SteamGridDB's "Hero" asset — their actual wide-banner category
// (~1920x620), the dedicated source for the banner slot now that Grid is
// its own separate picture instead of standing in for it.
ipcMain.handle('steamgriddb-heroes', (_event, gameId, page = 0) =>
  fetchSteamGridDbArt('heroes', gameId, page, 'Could not fetch SteamGridDB banner art.'));

// destPath is deterministic per (appPath, kind), so it gets overwritten on
// every pick — this only tracks which URL last wrote each destPath, so
// re-picking the exact same art (e.g. reopening the picker after cancelling)
// skips the network fetch instead of re-downloading bytes already on disk.
const downloadedUrlByPath = new Map();

ipcMain.handle('steamgriddb-download', async (_event, { url, appPath, kind }) => {
  try {
    const ext = (url.split('.').pop() || 'png').split('?')[0].slice(0, 4);
    const suffix = kind === 'icon' ? 'icon' : kind === 'grid' ? 'grid' : 'banner';
    const destPath = path.join(iconCacheDir(), `${slugFor(appPath)}_${suffix}.${ext}`);
    if (downloadedUrlByPath.get(destPath) === url && fs.existsSync(destPath)) {
      return { ok: true, path: destPath };
    }
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `Download failed (${res.status})` };
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(iconCacheDir(), { recursive: true });
    fs.writeFileSync(destPath, buf);
    downloadedUrlByPath.set(destPath, url);
    return { ok: true, path: destPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
