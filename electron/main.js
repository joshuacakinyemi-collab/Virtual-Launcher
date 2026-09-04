const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

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

const DEFAULT_THEME_COLOR = '#0e6cc4';
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
      // icon/banner split.
      bannerPath: item.banner_path || item.art_path || null,
      description: item.description || '',
      tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === 'string') : [],
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
      description: a.description || '',
      tags: a.tags || [],
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
  let themeColor = DEFAULT_THEME_COLOR;
  const customColors = {};
  if (data.theme_color) themeColor = data.theme_color;
  if (data.custom_colors && typeof data.custom_colors === 'object') {
    for (const [key, value] of Object.entries(data.custom_colors)) {
      if (['glow', 'tile'].includes(key) && typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
        customColors[key] = value;
      }
    }
  }
  return {
    themeColor,
    customColors,
    fontPath: typeof data.font_path === 'string' ? data.font_path : null,
    fontFamily: typeof data.font_family === 'string' ? data.font_family : null,
    fontSize: ['small', 'medium', 'large'].includes(data.font_size) ? data.font_size : 'medium',
    timezone: typeof data.timezone === 'string' ? data.timezone : null,
    timeFormat: data.time_format === '12h' ? '12h' : '24h',
  };
}

function saveSettings(themeColor, customColors) {
  writeRawSettings({ theme_color: themeColor, custom_colors: customColors });
}

function saveDisplaySettings({ fontPath, fontFamily, fontSize, timezone, timeFormat }) {
  writeRawSettings({
    font_path: fontPath || null,
    font_family: fontFamily || null,
    font_size: fontSize || 'medium',
    timezone: timezone || null,
    time_format: timeFormat === '12h' ? '12h' : '24h',
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
  if (process.platform !== 'darwin' || !appPath.endsWith('.app')) return null;

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_W,
    height: WINDOW_H,
    minWidth: 640,
    minHeight: 420,
    center: true,
    resizable: true,
    icon: APP_ICON_PATH,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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
  const { themeColor, customColors, fontPath, fontFamily, fontSize, timezone, timeFormat } = loadSettings();
  return {
    apps: loadApps(),
    user: loadUser(),
    themeColor,
    customColors,
    fontPath,
    fontFamily,
    fontSize,
    timezone,
    timeFormat,
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

ipcMain.handle('choose-font-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a font',
    properties: ['openFile'],
    filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('add-app', (_event, { name, path: appPath, bannerPath }) => {
  const apps = loadApps();
  const iconPath = extractAppIcon(appPath);
  apps.push({
    name, path: appPath, iconPath, bannerPath: bannerPath || null,
    description: '', tags: [], playtimeSeconds: 0, slug: slugFor(appPath),
  });
  saveApps(apps);
  return loadApps();
});

ipcMain.handle('update-app', (_event, { slug, name, description, tags, iconPath, bannerPath }) => {
  const apps = loadApps();
  const entry = apps.find((a) => a.slug === slug);
  if (!entry) return loadApps();
  if (typeof name === 'string' && name) entry.name = name;
  if (typeof description === 'string') entry.description = description;
  if (Array.isArray(tags)) entry.tags = tags;
  if (iconPath !== undefined) entry.iconPath = iconPath;
  if (bannerPath !== undefined) entry.bannerPath = bannerPath;
  saveApps(apps);
  return loadApps();
});

ipcMain.handle('remove-app', (_event, slug) => {
  const apps = loadApps();
  const entry = apps.find((a) => a.slug === slug);
  const remaining = apps.filter((a) => a.slug !== slug);
  for (const cachedPath of [entry?.iconPath, entry?.bannerPath]) {
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

ipcMain.handle('save-settings', (_event, { themeColor, customColors }) => {
  saveSettings(themeColor, customColors);
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
  const reshow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
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
  child.on('exit', reshow);
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

ipcMain.handle('steamgriddb-grids', async (_event, gameId) => {
  const key = loadSteamGridDbKey();
  if (!key) return { ok: false, error: 'No SteamGridDB API key set.' };
  try {
    const res = await fetch(`${STEAMGRIDDB_BASE}/grids/game/${gameId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await res.json();
    if (!res.ok || !json.success) return { ok: false, error: 'Could not fetch SteamGridDB art.' };
    return { ok: true, grids: (json.data || []).slice(0, 9).map((g) => ({ id: g.id, url: g.url, thumb: g.thumb })) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('steamgriddb-icons', async (_event, gameId) => {
  const key = loadSteamGridDbKey();
  if (!key) return { ok: false, error: 'No SteamGridDB API key set.' };
  try {
    const res = await fetch(`${STEAMGRIDDB_BASE}/icons/game/${gameId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await res.json();
    if (!res.ok || !json.success) return { ok: false, error: 'Could not fetch SteamGridDB icons.' };
    return { ok: true, grids: (json.data || []).slice(0, 9).map((g) => ({ id: g.id, url: g.url, thumb: g.thumb })) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('steamgriddb-download', async (_event, { url, appPath, kind }) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `Download failed (${res.status})` };
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(iconCacheDir(), { recursive: true });
    const ext = (url.split('.').pop() || 'png').split('?')[0].slice(0, 4);
    const suffix = kind === 'icon' ? 'icon' : 'banner';
    const destPath = path.join(iconCacheDir(), `${slugFor(appPath)}_${suffix}.${ext}`);
    fs.writeFileSync(destPath, buf);
    return { ok: true, path: destPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
