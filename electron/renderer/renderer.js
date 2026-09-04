const state = {
  apps: [], themeColor: '#0e6cc4', customColors: {}, theme: null, assetsDir: '',
  user: { name: 'Player', iconPath: null },
  fontPath: null, fontFamily: null, fontSize: 'medium',
  timezone: null, timeFormat: '24h', timezones: [],
};
const ui = { screen: 'menu', selectedSlug: null, updateGameSlug: null };

const COLOR_PARTS = [['accent', 'Menu Color'], ['glow', 'Glow'], ['tile', 'Tile']];
const SETTINGS_GRID_COLS = 4;

let clockInterval = null;
let currentKeyHandler = null;
let modalOpen = false;
let fontStyleEl = null;

function joinPath(...parts) {
  return parts.join('/').replace(/\/+/g, '/');
}

function fileUrl(p) {
  return 'file://' + encodeURI(p);
}

function formatClock() {
  const opts = { hour: '2-digit', minute: '2-digit', hour12: state.timeFormat === '12h' };
  if (state.timezone) opts.timeZone = state.timezone;
  return new Intl.DateTimeFormat('en-US', opts).format(new Date());
}

function formatPlaytime(seconds) {
  if (!seconds) return 'Never played';
  if (seconds < 60) return '<1m played';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m played`;
  if (m === 0) return `${h}h played`;
  return `${h}h ${m}m played`;
}

function findAppBySlug(slug) {
  return state.apps.find((a) => a.slug === slug) || null;
}

function applyTheme() {
  const t = state.theme;
  const root = document.documentElement.style;
  root.setProperty('--bg', t.bg);
  root.setProperty('--glow', t.glow);
  root.setProperty('--tile', t.tile);
  root.setProperty('--tile-overlay', t.tileOverlay);
  root.setProperty('--accent', state.themeColor);
  root.setProperty('--fg', Theme.readableFg(t.bg));
  root.setProperty('--dim-fg', Theme.mix(Theme.readableFg(t.bg), t.bg, 0.55));
  root.setProperty('--tile-fg', Theme.readableFg(t.tile));
  root.setProperty('--bubble-fg', Theme.readableFg(t.tileOverlay));
  root.setProperty('--bubble-fg-muted', Theme.mix(Theme.readableFg(t.tileOverlay), t.tileOverlay, 0.35));
  root.setProperty('--accent-fg', Theme.readableFg(state.themeColor));
}

function applyCustomFont(fontPath, family) {
  if (fontStyleEl) {
    fontStyleEl.remove();
    fontStyleEl = null;
  }
  if (fontPath && family) {
    fontStyleEl = document.createElement('style');
    fontStyleEl.textContent = `@font-face { font-family: '${family}'; src: url('${fileUrl(fontPath)}'); }`;
    document.head.appendChild(fontStyleEl);
    document.documentElement.style.setProperty('--user-font', `'${family}', 'Segoe UI', sans-serif`);
  } else {
    document.documentElement.style.removeProperty('--user-font');
  }
}

function applyFontSize(size) {
  document.documentElement.setAttribute('data-ui-size', size);
}

async function persistDisplaySettings() {
  await window.api.saveDisplaySettings({
    fontPath: state.fontPath,
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
    timezone: state.timezone,
    timeFormat: state.timeFormat,
  });
}

/* ---------- keyboard nav ---------- */

window.addEventListener('keydown', (e) => {
  if (modalOpen) return;
  if (currentKeyHandler) currentKeyHandler(e);
});

/* ---------- gamepad nav ---------- */

// The Web Gamepad API (navigator.getGamepads()) is built into Chromium, so
// this works identically on Windows/Linux/macOS with no OS-specific input
// code — Chromium already abstracts XInput/DirectInput/HID differences.
// Rather than duplicating every screen's key-handling logic for gamepad
// input, this maps D-pad/stick/face-buttons to the same key names and
// dispatches a REAL synthetic KeyboardEvent from the focused element. That
// single dispatch naturally reaches everything that already listens for
// keydown — the global handler above AND every modal's own listener
// (openModal, showConfirm, etc.) — with zero per-screen gamepad code.
const GAMEPAD_DEADZONE = 0.5;
const GAMEPAD_REPEAT_DELAY_MS = 420;
const GAMEPAD_REPEAT_RATE_MS = 130;
const GAMEPAD_ACTIONS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'];
const gamepadHeld = {};
const gamepadHeldSince = {};
const gamepadLastRepeat = {};

function dispatchSyntheticKey(key) {
  const target = document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function pollGamepads() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pressed = new Set();
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    const b = pad.buttons;
    const a = pad.axes;
    // Standard mapping: D-pad = buttons 12-15, left stick = axes 0/1,
    // A/Cross = button 0 (select), B/Circle = button 1 (back) — the same
    // layout Xbox/PlayStation/most generic USB pads report once Chromium
    // normalizes them to `gamepad.mapping === 'standard'`.
    if ((b[12] && b[12].pressed) || a[1] < -GAMEPAD_DEADZONE) pressed.add('ArrowUp');
    if ((b[13] && b[13].pressed) || a[1] > GAMEPAD_DEADZONE) pressed.add('ArrowDown');
    if ((b[14] && b[14].pressed) || a[0] < -GAMEPAD_DEADZONE) pressed.add('ArrowLeft');
    if ((b[15] && b[15].pressed) || a[0] > GAMEPAD_DEADZONE) pressed.add('ArrowRight');
    if (b[0] && b[0].pressed) pressed.add('Enter');
    if (b[1] && b[1].pressed) pressed.add('Escape');
  }

  const now = performance.now();
  for (const action of GAMEPAD_ACTIONS) {
    const isHeld = pressed.has(action);
    const wasHeld = !!gamepadHeld[action];
    if (isHeld && !wasHeld) {
      gamepadHeldSince[action] = now;
      gamepadLastRepeat[action] = now;
      dispatchSyntheticKey(action);
    } else if (isHeld && wasHeld) {
      const heldFor = now - gamepadHeldSince[action];
      const sinceRepeat = now - gamepadLastRepeat[action];
      if (heldFor > GAMEPAD_REPEAT_DELAY_MS && sinceRepeat > GAMEPAD_REPEAT_RATE_MS) {
        gamepadLastRepeat[action] = now;
        dispatchSyntheticKey(action);
      }
    }
    gamepadHeld[action] = isHeld;
  }

  requestAnimationFrame(pollGamepads);
}

// 1D nav: horizontal by default (tile strips), or vertical (Up/Down) for
// lists — vertical mode leaves Left/Right unhandled so a caller can use an
// unconsumed ArrowLeft to mean "leave this list" (e.g. back to the category
// rail) without the two meanings colliding.
function createNav(items, { onEscape, vertical = false } = {}) {
  let index = 0;
  function apply() {
    items.forEach((it, i) => it.el.classList.toggle('kbd-focus', i === index));
    // Follows the focused item into view when a list overflows its
    // container — 'nearest' only scrolls if it's actually off-screen, so
    // this is a no-op (no jitter) when everything already fits.
    items[index]?.el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
  if (items.length) apply();
  function move(delta) {
    if (!items.length) return;
    index = (index + delta + items.length) % items.length;
    apply();
  }
  function activate() {
    if (items.length) items[index].activate();
  }
  const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
  function handleKey(e) {
    if (e.key === prevKey) { move(-1); e.preventDefault(); return; }
    if (e.key === nextKey) { move(1); e.preventDefault(); return; }
    if (e.key === 'Enter' || e.key === ' ') { activate(); e.preventDefault(); return; }
    if (e.key === 'Escape' && onEscape) { onEscape(); e.preventDefault(); }
  }
  return { handleKey, move, activate, getIndex: () => index };
}

// 2D grid nav for the Settings grid. ArrowLeft at column 0 is deliberately
// left unhandled (no preventDefault) for the same "leave this zone" reason
// as createNav's vertical mode.
function create2DNav(items, cols, { onEscape } = {}) {
  let index = 0;
  function apply() {
    items.forEach((it, i) => it.el.classList.toggle('kbd-focus', i === index));
    items[index]?.el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
  if (items.length) apply();
  function moveTo(newIndex) {
    if (!items.length) return;
    index = Math.max(0, Math.min(items.length - 1, newIndex));
    apply();
  }
  function activate() {
    if (items.length) items[index].activate();
  }
  function handleKey(e) {
    switch (e.key) {
      case 'ArrowRight': moveTo(index + 1); e.preventDefault(); break;
      case 'ArrowLeft': if (index % cols !== 0) { moveTo(index - 1); e.preventDefault(); } break;
      case 'ArrowDown': moveTo(Math.min(items.length - 1, index + cols)); e.preventDefault(); break;
      case 'ArrowUp': moveTo(Math.max(0, index - cols)); e.preventDefault(); break;
      case 'Enter':
      case ' ': activate(); e.preventDefault(); break;
      case 'Escape': if (onEscape) { onEscape(); e.preventDefault(); } break;
      default: break;
    }
  }
  return { handleKey, activate, getIndex: () => index };
}

/* ---------- modals ---------- */

function openModal(build, { wide = false } = {}) {
  return new Promise((resolve) => {
    modalOpen = true;
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = wide ? 'modal wide' : 'modal';
    backdrop.appendChild(modal);

    function close(value) {
      modalOpen = false;
      root.innerHTML = '';
      resolve(value);
    }

    backdrop.addEventListener('keydown', (e) => e.stopPropagation());
    build(modal, close);
    root.appendChild(backdrop);
  });
}

function showPrompt(title, label, initialValue, { multiline = false } = {}) {
  return openModal((modal, close) => {
    const h = document.createElement('h3');
    h.textContent = title;
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    else input.rows = 4;
    input.value = initialValue || '';
    const buttons = document.createElement('div');
    buttons.className = 'modal-buttons';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'secondary';
    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.className = 'primary';
    buttons.append(cancelBtn, okBtn);
    modal.append(h, lbl, input, buttons);

    // Multiline (description) submits the raw value, including empty
    // string, so clearing a description is distinguishable from Cancel;
    // single-line fields keep the simpler "empty submit = cancel" behavior.
    cancelBtn.onclick = () => close(null);
    okBtn.onclick = () => close(multiline ? input.value : (input.value.trim() || null));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && !multiline) close(input.value.trim() || null);
    });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

function showConfirm(title, message, confirmLabel = 'Confirm') {
  return openModal((modal, close) => {
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = message;
    const buttons = document.createElement('div');
    buttons.className = 'modal-buttons';
    const noBtn = document.createElement('button');
    noBtn.textContent = 'Cancel';
    noBtn.className = 'secondary';
    const yesBtn = document.createElement('button');
    yesBtn.textContent = confirmLabel;
    yesBtn.className = 'primary';
    buttons.append(noBtn, yesBtn);
    modal.append(h, p, buttons);

    noBtn.onclick = () => close(false);
    yesBtn.onclick = () => close(true);
    modal.parentElement.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    });
    setTimeout(() => yesBtn.focus(), 0);
  });
}

function showError(title, message) {
  return openModal((modal, close) => {
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.style.whiteSpace = 'pre-wrap';
    p.textContent = message;
    const buttons = document.createElement('div');
    buttons.className = 'modal-buttons';
    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.className = 'primary';
    buttons.append(okBtn);
    modal.append(h, p, buttons);

    okBtn.onclick = () => close();
    modal.parentElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') close();
    });
    setTimeout(() => okBtn.focus(), 0);
  });
}

// Generic small choice modal — options: [{label, value, primary}].
function showChoice(title, message, options) {
  return openModal((modal, close) => {
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = message;
    const buttons = document.createElement('div');
    buttons.className = 'modal-buttons';
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.textContent = opt.label;
      btn.className = opt.primary ? 'primary' : 'secondary';
      btn.onclick = () => close(opt.value);
      buttons.appendChild(btn);
    });
    modal.append(h, p, buttons);
    modal.parentElement.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(null);
    });
  });
}

// Non-interactive modal for a brief async wait (SteamGridDB search/fetch) —
// unlike openModal, this returns a close() function immediately rather than
// a promise, since nothing here waits on the user.
function showLoadingModal(text) {
  modalOpen = true;
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const p = document.createElement('p');
  p.style.margin = '0';
  p.textContent = text;
  modal.appendChild(p);
  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  return () => {
    modalOpen = false;
    root.innerHTML = '';
  };
}

function showArtPicker(gameName, grids) {
  return openModal((modal, close) => {
    const h = document.createElement('h3');
    h.textContent = `Art for "${gameName}"`;
    const p = document.createElement('p');
    p.textContent = 'Pick one, or skip.';
    const grid = document.createElement('div');
    grid.className = 'art-grid';
    const thumbItems = [];
    grids.forEach((g) => {
      const img = document.createElement('img');
      img.className = 'art-thumb';
      img.src = g.thumb;
      img.addEventListener('click', () => close(g.url));
      grid.appendChild(img);
      thumbItems.push({ el: img, activate: () => close(g.url) });
    });
    const buttons = document.createElement('div');
    buttons.className = 'modal-buttons';
    const skipBtn = document.createElement('button');
    skipBtn.textContent = 'Skip';
    skipBtn.className = 'secondary';
    skipBtn.onclick = () => close(null);
    buttons.appendChild(skipBtn);
    modal.append(h, p, grid, buttons);

    // 3 columns to match .art-grid's own grid-template-columns, so
    // arrow-key/gamepad nav lines up with the actual visual layout.
    const items = thumbItems.concat([{ el: skipBtn, activate: () => close(null) }]);
    const nav = create2DNav(items, 3, { onEscape: () => close(null) });
    modal.parentElement.addEventListener('keydown', (e) => nav.handleKey(e));
  }, { wide: true });
}

async function manageSteamGridDbKey() {
  const current = await window.api.getSteamGridDbKey();
  const key = await showPrompt(
    'SteamGridDB API Key',
    'Paste your key from steamgriddb.com/profile/preferences — used to fetch cover art and icons.',
    current,
  );
  if (key === null) return;
  await window.api.saveSteamGridDbKey(key);
}

// Looks up art for a game on SteamGridDB. kind is 'icon' or 'banner'.
// Returns a local file path on success, or null on any failure (no key,
// no results, download error) — every caller treats null as "no change",
// so a SteamGridDB hiccup never blocks the surrounding flow.
async function pickSteamGridDbArt(name, appPath, kind = 'banner') {
  const key = await window.api.getSteamGridDbKey();
  if (!key) return null;

  let hideLoading = showLoadingModal(`Searching SteamGridDB for "${name}"…`);
  const searchRes = await window.api.steamGridDbSearch(name);
  hideLoading();
  if (!searchRes.ok || !searchRes.results.length) return null;

  hideLoading = showLoadingModal(kind === 'icon' ? 'Fetching icon options…' : 'Fetching cover art options…');
  const gridsRes = kind === 'icon'
    ? await window.api.steamGridDbIcons(searchRes.results[0].id)
    : await window.api.steamGridDbGrids(searchRes.results[0].id);
  hideLoading();
  if (!gridsRes.ok || !gridsRes.grids.length) return null;

  const chosenUrl = await showArtPicker(searchRes.results[0].name, gridsRes.grids);
  if (!chosenUrl) return null;

  hideLoading = showLoadingModal('Downloading…');
  const dl = await window.api.steamGridDbDownload({ url: chosenUrl, appPath, kind });
  hideLoading();
  return dl.ok ? dl.path : null;
}

// Shared by Update Game's Change Icon / Change Banner rows and Add Game.
// Returns undefined for "no change" (user cancelled) vs a string path.
async function pickImageFor(kind, gameName, appPath) {
  const choice = await showChoice(
    kind === 'icon' ? 'Change Icon' : 'Change Banner',
    'Search SteamGridDB, or choose a file from your computer.',
    [
      { label: 'SteamGridDB', value: 'search', primary: true },
      { label: 'Choose File', value: 'file' },
      { label: 'Cancel', value: 'cancel' },
    ],
  );
  if (!choice || choice === 'cancel') return undefined;
  if (choice === 'file') {
    const picked = await window.api.chooseImagePath();
    return picked || undefined;
  }
  const result = await pickSteamGridDbArt(gameName, appPath, kind);
  return result || undefined;
}

/* ---------- shared tile helpers (Remove Game, Update Game picker, Settings grid) ---------- */

function tileIconNode(entry) {
  if (entry.kind === 'game') {
    if (entry.bannerPath) {
      const img = document.createElement('img');
      img.className = 'art-cover';
      img.src = fileUrl(entry.bannerPath);
      img.alt = entry.name;
      return img;
    }
    if (entry.iconPath) {
      const img = document.createElement('img');
      img.className = 'icon-img';
      img.src = fileUrl(entry.iconPath);
      img.alt = entry.name;
      return img;
    }
    const span = document.createElement('span');
    span.className = 'letter';
    span.textContent = (entry.name[0] || '?').toUpperCase();
    return span;
  }
  if (entry.kind === 'add') {
    const img = document.createElement('img');
    img.className = 'icon-img';
    img.src = fileUrl(joinPath(state.assetsDir, 'ps4_plus.png'));
    img.alt = 'Add';
    return img;
  }
  const emojiMap = {
    remove: '🗑', color: '🎨', steamgriddb: '🖼', back: '←', settings: '⚙', quit: '⏻',
    updateGame: '📝', updateUser: '👤', font: '🔤', time: '🕒',
  };
  const span = document.createElement('span');
  span.className = 'letter';
  span.textContent = emojiMap[entry.kind] || '?';
  return span;
}

function menuActionWord(entry) {
  if (entry.kind === 'back') return 'Back';
  return 'Open';
}

function removeActionWord(entry) {
  return entry.kind === 'back' ? 'Back' : 'Remove';
}

function updateActionWord(entry) {
  return entry.kind === 'back' ? 'Back' : 'Edit';
}

function buildTile(entry, actionWord) {
  const wrap = document.createElement('div');
  wrap.className = 'tile-wrap';

  const anchor = document.createElement('div');
  anchor.className = 'tile-anchor';

  const surface = document.createElement('div');
  surface.className = 'tile-surface';
  surface.appendChild(tileIconNode(entry));
  anchor.appendChild(surface);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const nameEl = document.createElement('div');
  nameEl.className = 'bubble-name';
  nameEl.textContent = entry.name;
  const actionEl = document.createElement('div');
  actionEl.className = 'bubble-action';
  actionEl.textContent = actionWord;
  bubble.append(nameEl, actionEl);
  anchor.appendChild(bubble);

  wrap.appendChild(anchor);
  return wrap;
}

function buildTileStrip(entries, onActivate, actionWordFn) {
  const outer = document.createElement('div');
  outer.className = 'tile-strip-outer';
  const strip = document.createElement('div');
  strip.className = 'tile-strip';
  const items = [];
  entries.forEach((entry) => {
    const wrap = buildTile(entry, actionWordFn(entry));
    wrap.addEventListener('click', () => onActivate(entry));
    strip.appendChild(wrap);
    items.push({ el: wrap, activate: () => onActivate(entry) });
  });
  outer.appendChild(strip);
  return { stripEl: outer, items };
}

function buildSettingsGrid(entries, onActivate) {
  const outer = document.createElement('div');
  outer.className = 'settings-grid-outer';
  const grid = document.createElement('div');
  grid.className = 'settings-grid';
  const items = [];
  entries.forEach((entry) => {
    const wrap = buildTile(entry, menuActionWord(entry));
    wrap.addEventListener('click', () => onActivate(entry));
    grid.appendChild(wrap);
    items.push({ el: wrap, activate: () => onActivate(entry) });
  });
  outer.appendChild(grid);
  return { gridEl: outer, items };
}

function buildGameList(entries, onSelect) {
  const outer = document.createElement('div');
  outer.className = 'game-list-outer';
  const list = document.createElement('div');
  list.className = 'game-list';
  const items = [];
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'game-list-empty';
    empty.textContent = 'No games yet — add one from Settings.';
    list.appendChild(empty);
  }
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = entry.kind === 'settings' ? 'game-row game-row-settings' : 'game-row';
    const thumb = document.createElement('div');
    thumb.className = 'game-row-thumb';
    thumb.appendChild(tileIconNode(entry));
    const name = document.createElement('div');
    name.className = 'game-row-name';
    name.textContent = entry.name;
    row.append(thumb, name);
    row.addEventListener('click', () => onSelect(entry));
    list.appendChild(row);
    items.push({ el: row, activate: () => onSelect(entry) });
  });
  outer.appendChild(list);
  return { listEl: outer, items };
}

function setHints(items) {
  const footer = document.getElementById('footer-hints');
  footer.innerHTML = '';
  items.forEach(({ key, label }) => {
    const hint = document.createElement('span');
    hint.className = 'hint';
    const k = document.createElement('span');
    k.className = 'hint-key';
    k.textContent = key;
    const l = document.createElement('span');
    l.textContent = label;
    hint.append(k, l);
    footer.appendChild(hint);
  });
}

function buildScreenTitle(text) {
  const el = document.createElement('div');
  el.className = 'screen-title';
  el.textContent = text;
  return el;
}

// Persistent header used by every screen: player icon+name (click to edit),
// clock, a settings-gear shortcut, and power. Sub-screens show their own
// heading in the body via buildScreenTitle instead of the header changing.
// Purely informational — no interactive controls live here. Header buttons
// (Settings gear, Power) used to be mouse-only dead ends for a controller,
// since nothing in this app is Tab-reachable outside the sidebar's own
// nav. Settings and Quit are now sidebar entries instead (see renderMenu),
// so every action is reachable the same way: navigate the list, press
// Enter/Select.
function buildHeader() {
  const header = document.createElement('div');
  header.className = 'header';

  const left = document.createElement('div');
  left.className = 'header-left';
  const playerIcon = document.createElement('div');
  playerIcon.className = 'header-player-icon';
  if (state.user.iconPath) {
    const img = document.createElement('img');
    img.src = fileUrl(state.user.iconPath);
    img.alt = state.user.name;
    playerIcon.appendChild(img);
  } else {
    playerIcon.textContent = (state.user.name[0] || 'P').toUpperCase();
  }
  const playerName = document.createElement('div');
  playerName.className = 'header-player-name';
  playerName.textContent = state.user.name;
  left.append(playerIcon, playerName);

  const right = document.createElement('div');
  right.className = 'header-right';

  const clock = document.createElement('div');
  clock.className = 'clock';
  clock.textContent = formatClock();
  clockInterval = setInterval(() => { clock.textContent = formatClock(); }, 1000);

  right.append(clock);
  header.append(left, right);
  return header;
}

/* ---------- central render ---------- */

function render() {
  clearInterval(clockInterval);
  currentKeyHandler = null;
  const appEl = document.getElementById('app');
  appEl.innerHTML = '';
  if (ui.screen === 'menu') renderMenu(appEl);
  else if (ui.screen === 'settings') renderSettings(appEl);
  else if (ui.screen === 'detail') renderDetail(appEl);
  else if (ui.screen === 'remove') renderRemove(appEl);
  else if (ui.screen === 'color') renderColor(appEl);
  else if (ui.screen === 'updateGamePick') renderUpdateGamePick(appEl);
  else if (ui.screen === 'updateGameEdit') renderUpdateGameEdit(appEl);
  else if (ui.screen === 'font') renderFont(appEl);
  else if (ui.screen === 'time') renderTime(appEl);
}

/* ---------- home: games sidebar ---------- */

function settingsEntries() {
  return [
    { kind: 'add', name: 'Add Game' },
    { kind: 'remove', name: 'Remove Game' },
    { kind: 'updateGame', name: 'Update Game' },
    { kind: 'color', name: 'Menu Color' },
    { kind: 'updateUser', name: 'Update User' },
    { kind: 'font', name: 'Change Font' },
    { kind: 'time', name: 'Time Setting' },
    { kind: 'steamgriddb', name: 'Cover Art Key' },
    { kind: 'back', name: 'Back' },
  ];
}

async function activateSettingsEntry(entry) {
  if (entry.kind === 'add') await addGameFlow();
  else if (entry.kind === 'remove') { ui.screen = 'remove'; render(); }
  else if (entry.kind === 'updateGame') { ui.screen = 'updateGamePick'; render(); }
  else if (entry.kind === 'color') { ui.screen = 'color'; render(); }
  else if (entry.kind === 'updateUser') await manageUpdateUser();
  else if (entry.kind === 'font') { ui.screen = 'font'; render(); }
  else if (entry.kind === 'time') { ui.screen = 'time'; render(); }
  else if (entry.kind === 'steamgriddb') await manageSteamGridDbKey();
  else if (entry.kind === 'back') { ui.screen = 'menu'; render(); }
}

async function launchGame(entry) {
  const result = await window.api.launchApp(entry.path);
  if (!result.ok) await showError('Launch failed', result.error);
}

async function addGameFlow() {
  const chosen = await window.api.chooseAppPath();
  if (!chosen) return;
  const base = chosen.replace(/\/+$/, '').split('/').pop();
  const defaultName = base.replace(/\.[^.]+$/, '');
  const name = await showPrompt('New app', 'Name:', defaultName);
  if (!name) return;
  const bannerPath = await pickSteamGridDbArt(name, chosen, 'banner');
  state.apps = await window.api.addApp({ name, path: chosen, bannerPath });
  render();
}

async function manageUpdateUser() {
  const name = await showPrompt('Update Player', 'Name:', state.user.name);
  const choice = await showChoice('Player Icon', 'Choose a new icon, or keep the current one.', [
    { label: 'Choose File', value: 'file', primary: true },
    { label: 'Keep Current', value: 'keep' },
  ]);
  let iconPath;
  if (choice === 'file') {
    const picked = await window.api.chooseImagePath();
    if (picked) iconPath = picked;
  }
  const payload = {};
  if (name) payload.name = name;
  if (iconPath) payload.iconPath = iconPath;
  if (Object.keys(payload).length === 0) return;
  state.user = await window.api.updateUser(payload);
  render();
}

// Home screen: the sidebar holds the games directly (no separate category
// step to get to them) plus a Settings entry at the end. Selecting a game
// opens its detail/Play screen; selecting Settings opens the settings grid.
function renderMenu(appEl) {
  const header = buildHeader();

  const body = document.createElement('div');
  body.className = 'body';

  const entries = state.apps.map((a) => ({ kind: 'game', ...a }))
    .concat([{ kind: 'settings', name: 'Settings' }, { kind: 'quit', name: 'Quit' }]);
  const { listEl, items } = buildGameList(entries, async (entry) => {
    if (entry.kind === 'settings') {
      ui.screen = 'settings';
      render();
      return;
    }
    if (entry.kind === 'quit') {
      if (await showConfirm('Quit', 'Quit the launcher?', 'Quit')) window.api.quit();
      return;
    }
    ui.selectedSlug = entry.slug;
    ui.screen = 'detail';
    render();
  });
  body.appendChild(listEl);
  appEl.append(header, body);

  const nav = createNav(items, { vertical: true });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '↑↓', label: 'Navigate' }, { key: 'Enter', label: 'Select' }]);
}

/* ---------- settings grid ---------- */

function renderSettings(appEl) {
  const header = buildHeader();
  const body = document.createElement('div');
  body.className = 'subscreen-body';
  body.appendChild(buildScreenTitle('Settings'));

  const { gridEl, items } = buildSettingsGrid(settingsEntries(), activateSettingsEntry);
  body.appendChild(gridEl);
  appEl.append(header, body);

  const goBack = () => { ui.screen = 'menu'; render(); };
  const nav = create2DNav(items, SETTINGS_GRID_COLS, { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '↑↓←→', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }]);
}

/* ---------- game detail / play ---------- */

function renderDetail(appEl) {
  const entry = findAppBySlug(ui.selectedSlug);
  if (!entry) {
    ui.screen = 'menu';
    render();
    return;
  }

  const header = buildHeader();
  const body = document.createElement('div');
  body.className = 'detail-body';

  const top = document.createElement('div');
  top.className = 'detail-top';

  const iconBox = document.createElement('div');
  iconBox.className = 'detail-icon-box';
  if (entry.iconPath) {
    const img = document.createElement('img');
    img.src = fileUrl(entry.iconPath);
    img.alt = entry.name;
    iconBox.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className = 'letter';
    span.textContent = (entry.name[0] || '?').toUpperCase();
    iconBox.appendChild(span);
  }

  const bannerCol = document.createElement('div');
  bannerCol.className = 'detail-banner-col';
  const bannerBox = document.createElement('div');
  bannerBox.className = 'detail-banner-box';
  if (entry.bannerPath) {
    const img = document.createElement('img');
    img.src = fileUrl(entry.bannerPath);
    img.alt = entry.name;
    bannerBox.appendChild(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.textContent = 'No banner — add one from Settings → Update Game';
    bannerBox.appendChild(placeholder);
  }

  const metaRow = document.createElement('div');
  metaRow.className = 'detail-meta-row';
  const titleEl = document.createElement('div');
  titleEl.className = 'detail-title';
  titleEl.textContent = entry.name;
  const playtimeEl = document.createElement('div');
  playtimeEl.className = 'detail-playtime';
  playtimeEl.textContent = formatPlaytime(entry.playtimeSeconds);
  metaRow.append(titleEl, playtimeEl);
  bannerCol.append(bannerBox, metaRow);

  top.append(iconBox, bannerCol);

  const desc = document.createElement('div');
  desc.className = 'detail-description';
  desc.textContent = entry.description || 'No description yet — add one from Settings → Update Game.';

  const tagsRow = document.createElement('div');
  tagsRow.className = 'detail-tags';
  (entry.tags || []).forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = tag;
    tagsRow.appendChild(chip);
  });

  const actions = document.createElement('div');
  actions.className = 'detail-actions';
  const playBtn = document.createElement('div');
  playBtn.className = 'detail-btn primary';
  playBtn.textContent = 'Play';
  const cancelBtn = document.createElement('div');
  cancelBtn.className = 'detail-btn secondary';
  cancelBtn.textContent = 'Cancel';
  const goBack = () => { ui.screen = 'menu'; render(); };
  playBtn.addEventListener('click', () => launchGame(entry));
  cancelBtn.addEventListener('click', goBack);
  actions.append(playBtn, cancelBtn);

  body.append(top, desc, tagsRow, actions);
  appEl.append(header, body);

  const nav = createNav([
    { el: playBtn, activate: () => launchGame(entry) },
    { el: cancelBtn, activate: goBack },
  ], { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '←→', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Cancel' }]);
}

/* ---------- remove game ---------- */

async function activateRemoveEntry(entry) {
  if (entry.kind === 'back') { ui.screen = 'settings'; render(); return; }
  const ok = await showConfirm('Remove game', `Remove "${entry.name}" from the launcher?`, 'Remove');
  if (ok) {
    state.apps = await window.api.removeApp(entry.slug);
    render();
  }
}

function renderRemove(appEl) {
  const header = buildHeader();
  const body = document.createElement('div');
  body.className = 'subscreen-body';
  body.appendChild(buildScreenTitle('Remove Game'));

  const entries = state.apps.map((a) => ({ kind: 'game', ...a })).concat([{ kind: 'back', name: 'Back' }]);
  const { stripEl, items } = buildTileStrip(entries, activateRemoveEntry, removeActionWord);
  body.appendChild(stripEl);

  appEl.append(header, body);

  const nav = createNav(items, { onEscape: () => { ui.screen = 'settings'; render(); } });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '←→', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }]);
}

/* ---------- update game: pick, then edit ---------- */

function renderUpdateGamePick(appEl) {
  const header = buildHeader();
  const body = document.createElement('div');
  body.className = 'subscreen-body';
  body.appendChild(buildScreenTitle('Update Game'));

  const entries = state.apps.map((a) => ({ kind: 'game', ...a })).concat([{ kind: 'back', name: 'Back' }]);
  const { stripEl, items } = buildTileStrip(entries, (entry) => {
    if (entry.kind === 'back') { ui.screen = 'settings'; render(); return; }
    ui.updateGameSlug = entry.slug;
    ui.screen = 'updateGameEdit';
    render();
  }, updateActionWord);
  body.appendChild(stripEl);

  appEl.append(header, body);

  const nav = createNav(items, { onEscape: () => { ui.screen = 'settings'; render(); } });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '←→', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }]);
}

function renderUpdateGameEdit(appEl) {
  const entry = findAppBySlug(ui.updateGameSlug);
  if (!entry) {
    ui.screen = 'settings';
    render();
    return;
  }

  const header = buildHeader();
  const body = document.createElement('div');
  body.className = 'subscreen-body';
  body.appendChild(buildScreenTitle(`Update: ${entry.name}`));

  const form = document.createElement('div');
  form.className = 'update-form';

  async function editField(key) {
    if (key === 'name') {
      const name = await showPrompt('Name', 'Game name:', entry.name);
      if (!name) return;
      state.apps = await window.api.updateApp({ slug: entry.slug, name });
      render();
    } else if (key === 'description') {
      const description = await showPrompt('Description', 'Short description:', entry.description || '', { multiline: true });
      if (description === null) return;
      state.apps = await window.api.updateApp({ slug: entry.slug, description });
      render();
    } else if (key === 'tags') {
      const tagsText = await showPrompt('Tags', 'Comma-separated tags:', (entry.tags || []).join(', '));
      if (tagsText === null) return;
      const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
      state.apps = await window.api.updateApp({ slug: entry.slug, tags });
      render();
    }
  }

  const fieldRows = [
    { label: 'Name', value: entry.name, key: 'name' },
    { label: 'Description', value: entry.description || '(none)', key: 'description' },
    { label: 'Tags', value: (entry.tags && entry.tags.length) ? entry.tags.join(', ') : '(none)', key: 'tags' },
  ].map((r) => {
    const row = document.createElement('div');
    row.className = 'update-row';
    const lbl = document.createElement('div');
    lbl.className = 'update-row-label';
    lbl.textContent = r.label;
    const val = document.createElement('div');
    val.className = 'update-row-value';
    val.textContent = r.value;
    row.append(lbl, val);
    row.addEventListener('click', () => editField(r.key));
    form.appendChild(row);
    return { el: row, activate: () => editField(r.key) };
  });

  const iconRow = document.createElement('div');
  iconRow.className = 'update-row';
  const iconLabel = document.createElement('div');
  iconLabel.className = 'update-row-label';
  iconLabel.textContent = 'Icon';
  const iconVal = document.createElement('div');
  iconVal.className = 'update-row-value';
  iconVal.textContent = entry.iconPath ? 'Set' : '(none)';
  iconRow.append(iconLabel, iconVal);
  const doChangeIcon = async () => {
    const result = await pickImageFor('icon', entry.name, entry.path);
    if (result !== undefined) {
      state.apps = await window.api.updateApp({ slug: entry.slug, iconPath: result });
      render();
    }
  };
  iconRow.addEventListener('click', doChangeIcon);

  const bannerRow = document.createElement('div');
  bannerRow.className = 'update-row';
  const bannerLabel = document.createElement('div');
  bannerLabel.className = 'update-row-label';
  bannerLabel.textContent = 'Banner';
  const bannerVal = document.createElement('div');
  bannerVal.className = 'update-row-value';
  bannerVal.textContent = entry.bannerPath ? 'Set' : '(none)';
  bannerRow.append(bannerLabel, bannerVal);
  const doChangeBanner = async () => {
    const result = await pickImageFor('banner', entry.name, entry.path);
    if (result !== undefined) {
      state.apps = await window.api.updateApp({ slug: entry.slug, bannerPath: result });
      render();
    }
  };
  bannerRow.addEventListener('click', doChangeBanner);

  form.append(iconRow, bannerRow);

  const goBack = () => { ui.screen = 'updateGamePick'; render(); };
  const backBtn = document.createElement('div');
  backBtn.className = 'detail-btn secondary';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', goBack);

  body.append(form, backBtn);
  appEl.append(header, body);

  const items = [
    ...fieldRows,
    { el: iconRow, activate: doChangeIcon },
    { el: bannerRow, activate: doChangeBanner },
    { el: backBtn, activate: goBack },
  ];
  const nav = createNav(items, { vertical: true, onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '↑↓', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }]);
}

/* ---------- font settings ---------- */

function renderFont(appEl) {
  const header = buildHeader();
  const body = document.createElement('div');
  body.className = 'subscreen-body';
  body.appendChild(buildScreenTitle('Change Font'));

  const form = document.createElement('div');
  form.className = 'update-form';

  const importRow = document.createElement('div');
  importRow.className = 'update-row';
  importRow.textContent = state.fontFamily ? `Custom font: ${state.fontFamily} (click to change)` : 'Import Font File…';
  importRow.addEventListener('click', async () => {
    const picked = await window.api.chooseFontPath();
    if (!picked) return;
    const family = 'CustomUserFont';
    applyCustomFont(picked, family);
    state.fontPath = picked;
    state.fontFamily = family;
    await persistDisplaySettings();
    render();
  });

  const resetRow = document.createElement('div');
  resetRow.className = 'update-row';
  resetRow.textContent = 'Reset to Default Font';
  resetRow.addEventListener('click', async () => {
    applyCustomFont(null, null);
    state.fontPath = null;
    state.fontFamily = null;
    await persistDisplaySettings();
    render();
  });

  form.append(importRow, resetRow);

  const sizeRow = document.createElement('div');
  sizeRow.className = 'size-options';
  const sizeBtns = ['small', 'medium', 'large'].map((size) => {
    const btn = document.createElement('div');
    btn.className = 'detail-btn secondary' + (state.fontSize === size ? ' active' : '');
    btn.textContent = size[0].toUpperCase() + size.slice(1);
    btn.addEventListener('click', async () => {
      applyFontSize(size);
      state.fontSize = size;
      await persistDisplaySettings();
      render();
    });
    sizeRow.appendChild(btn);
    return btn;
  });

  const goBack = () => { ui.screen = 'settings'; render(); };
  const backBtn = document.createElement('div');
  backBtn.className = 'detail-btn secondary';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', goBack);

  body.append(form, sizeRow, backBtn);
  appEl.append(header, body);

  const items = [
    { el: importRow, activate: () => importRow.click() },
    { el: resetRow, activate: () => resetRow.click() },
    ...sizeBtns.map((b) => ({ el: b, activate: () => b.click() })),
    { el: backBtn, activate: goBack },
  ];
  const nav = createNav(items, { vertical: true, onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '↑↓', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }]);
}

/* ---------- time settings ---------- */

function renderTime(appEl) {
  const header = buildHeader();
  const body = document.createElement('div');
  body.className = 'subscreen-body';
  body.appendChild(buildScreenTitle('Time Setting'));

  const formatRow = document.createElement('div');
  formatRow.className = 'size-options';
  const formatBtns = ['24h', '12h'].map((fmt) => {
    const btn = document.createElement('div');
    btn.className = 'detail-btn secondary' + (state.timeFormat === fmt ? ' active' : '');
    btn.textContent = fmt === '24h' ? '24-hour' : '12-hour';
    btn.addEventListener('click', async () => {
      state.timeFormat = fmt;
      await persistDisplaySettings();
      render();
    });
    formatRow.appendChild(btn);
    return btn;
  });

  const list = document.createElement('div');
  list.className = 'timezone-list';
  const zones = ['System Default', ...state.timezones];
  const zoneRows = zones.map((tz) => {
    const isCurrent = (tz === 'System Default' && !state.timezone) || tz === state.timezone;
    const row = document.createElement('div');
    row.className = 'timezone-row' + (isCurrent ? ' active' : '');
    row.textContent = tz;
    row.addEventListener('click', async () => {
      state.timezone = tz === 'System Default' ? null : tz;
      await persistDisplaySettings();
      render();
    });
    list.appendChild(row);
    return row;
  });

  const goBack = () => { ui.screen = 'settings'; render(); };
  const backBtn = document.createElement('div');
  backBtn.className = 'detail-btn secondary';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', goBack);

  body.append(formatRow, list, backBtn);
  appEl.append(header, body);

  const items = [
    ...formatBtns.map((b) => ({ el: b, activate: () => b.click() })),
    ...zoneRows.map((r) => ({ el: r, activate: () => r.click() })),
    { el: backBtn, activate: goBack },
  ];
  const nav = createNav(items, { vertical: true, onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '↑↓', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }]);
}

/* ---------- menu color ---------- */

function renderColor(appEl) {
  const header = buildHeader();
  const body = document.createElement('div');
  body.className = 'color-body';
  body.appendChild(buildScreenTitle('Menu Color'));

  const colorState = {
    values: {
      accent: Theme.hexToRgb(state.themeColor),
      glow: Theme.hexToRgb(state.theme.glow),
      tile: Theme.hexToRgb(state.theme.tile),
    },
    partIndex: 0,
    rowIndex: 0, // 0 = part tabs, 1-3 = R/G/B, 4 = Apply, 5 = Back
  };

  const tabsRow = document.createElement('div');
  tabsRow.className = 'color-tabs';
  const tabEls = COLOR_PARTS.map(([, label], i) => {
    const tab = document.createElement('div');
    tab.className = 'color-tab';
    tab.textContent = label;
    tab.addEventListener('click', () => { colorState.partIndex = i; colorState.rowIndex = 0; refresh(); });
    tabsRow.appendChild(tab);
    return tab;
  });

  const preview = document.createElement('div');
  preview.className = 'color-preview';

  const rowsWrap = document.createElement('div');
  rowsWrap.className = 'color-rows';
  const rowEls = ['Red', 'Green', 'Blue'].map((label, i) => {
    const row = document.createElement('div');
    row.className = 'color-row';
    const lbl = document.createElement('div');
    lbl.className = 'color-row-label';
    lbl.textContent = label;
    const bar = document.createElement('div');
    bar.className = 'color-bar';
    const fill = document.createElement('div');
    fill.className = 'color-bar-fill';
    bar.appendChild(fill);
    const value = document.createElement('div');
    value.className = 'color-row-value';
    row.append(lbl, bar, value);
    rowsWrap.appendChild(row);

    row.addEventListener('click', () => { colorState.rowIndex = i + 1; refresh(); });

    function setFromEvent(e) {
      const rect = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      colorState.rowIndex = i + 1;
      colorState.values[COLOR_PARTS[colorState.partIndex][0]][i] = Math.round((x / rect.width) * 255);
      refresh();
    }
    bar.addEventListener('mousedown', (e) => {
      setFromEvent(e);
      const onMove = (ev) => setFromEvent(ev);
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    return { row, fill, value };
  });

  const actions = document.createElement('div');
  actions.className = 'color-actions';
  const applyBtn = document.createElement('div');
  applyBtn.className = 'color-action-btn';
  applyBtn.textContent = 'Apply';
  const backBtn = document.createElement('div');
  backBtn.className = 'color-action-btn';
  backBtn.textContent = 'Back';
  applyBtn.addEventListener('click', () => { colorState.rowIndex = 4; applyColor(); });
  backBtn.addEventListener('click', () => { ui.screen = 'settings'; render(); });
  actions.append(applyBtn, backBtn);

  body.append(tabsRow, preview, rowsWrap, actions);
  appEl.append(header, body);

  function refresh() {
    const values = colorState.values[COLOR_PARTS[colorState.partIndex][0]];
    preview.style.background = Theme.rgbToHex(values);

    tabEls.forEach((tab, i) => {
      const active = colorState.partIndex === i;
      tab.classList.toggle('active', active);
      tab.classList.toggle('focused', active && colorState.rowIndex === 0);
    });
    rowEls.forEach((r, i) => {
      const v = values[i];
      r.value.textContent = String(v);
      r.fill.style.width = `${(v / 255) * 100}%`;
      r.row.classList.toggle('focused', colorState.rowIndex === i + 1);
    });
    applyBtn.classList.toggle('focused', colorState.rowIndex === 4);
    backBtn.classList.toggle('focused', colorState.rowIndex === 5);
  }

  async function applyColor() {
    const accentHex = Theme.rgbToHex(colorState.values.accent);
    const glowHex = Theme.rgbToHex(colorState.values.glow);
    const tileHex = Theme.rgbToHex(colorState.values.tile);
    const customColors = { glow: glowHex, tile: tileHex };
    await window.api.saveSettings({ themeColor: accentHex, customColors });
    state.themeColor = accentHex;
    state.customColors = customColors;
    state.theme = Theme.computeTheme(accentHex, customColors);
    applyTheme();
    ui.screen = 'settings';
    render();
  }

  currentKeyHandler = (e) => {
    switch (e.key) {
      case 'ArrowUp':
        colorState.rowIndex = (colorState.rowIndex - 1 + 6) % 6;
        refresh();
        e.preventDefault();
        break;
      case 'ArrowDown':
        colorState.rowIndex = (colorState.rowIndex + 1) % 6;
        refresh();
        e.preventDefault();
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (colorState.rowIndex === 0) {
          colorState.partIndex = (colorState.partIndex + dir + COLOR_PARTS.length) % COLOR_PARTS.length;
        } else if (colorState.rowIndex >= 1 && colorState.rowIndex <= 3) {
          const channel = colorState.rowIndex - 1;
          const values = colorState.values[COLOR_PARTS[colorState.partIndex][0]];
          values[channel] = Math.max(0, Math.min(255, values[channel] + dir * 8));
        }
        refresh();
        e.preventDefault();
        break;
      }
      case 'Enter':
      case ' ':
        if (colorState.rowIndex === 4) applyColor();
        else if (colorState.rowIndex === 5) { ui.screen = 'settings'; render(); }
        e.preventDefault();
        break;
      case 'Escape':
        ui.screen = 'settings';
        render();
        e.preventDefault();
        break;
      default:
        break;
    }
  };

  refresh();

  setHints([
    { key: '↑↓', label: 'Row' },
    { key: '←→', label: 'Adjust' },
    { key: 'Enter', label: 'Select' },
    { key: 'Esc', label: 'Back' },
  ]);
}

/* ---------- init ---------- */

async function init() {
  const data = await window.api.getState();
  state.apps = data.apps;
  state.user = data.user;
  state.themeColor = data.themeColor;
  state.customColors = data.customColors;
  state.assetsDir = data.assetsDir;
  state.fontPath = data.fontPath;
  state.fontFamily = data.fontFamily;
  state.fontSize = data.fontSize;
  state.timezone = data.timezone;
  state.timeFormat = data.timeFormat;
  state.timezones = data.timezones;
  state.theme = Theme.computeTheme(state.themeColor, state.customColors);
  applyTheme();
  if (state.fontPath && state.fontFamily) applyCustomFont(state.fontPath, state.fontFamily);
  applyFontSize(state.fontSize);

  window.api.onAppsUpdated((apps) => {
    state.apps = apps;
    if (ui.screen === 'menu' || ui.screen === 'detail') render();
  });

  requestAnimationFrame(pollGamepads);
  render();
}

window.addEventListener('DOMContentLoaded', init);
