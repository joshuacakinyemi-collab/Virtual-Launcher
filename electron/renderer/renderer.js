const state = {
  apps: [], themeColor: '#0e6cc4', themeMode: 'dark', theme: null, assetsDir: '',
  user: { name: 'Player', iconPath: null },
  fontPath: null, fontFamily: null, fontSize: 'medium', customFonts: [],
  timezone: null, timeFormat: '24h', timezones: [], showSeconds: false,
};
const ui = { screen: 'menu', updateGameSlug: null, selectedSlug: null };

// A curated accent palette (Menu Color) — picking one of these recolors
// the whole theme in one step; glow/tile always derive from it
// (Theme.computeTheme), so the result can't end up mismatched the way
// independently adjustable glow/tile sliders used to allow.
const PRESET_ACCENTS = [
  ['#2f8fe0', 'Ocean Blue'],
  ['#4338ca', 'Deep Indigo'],
  ['#7c5cff', 'Royal Purple'],
  ['#b53dff', 'Magenta'],
  ['#ff2d95', 'Hot Pink'],
  ['#e0473f', 'Crimson'],
  ['#ff8a3d', 'Sunset Orange'],
  ['#f2b705', 'Golden Yellow'],
  ['#2ecc71', 'Emerald'],
  ['#21965c', 'Forest Green'],
  ['#17c3b2', 'Teal'],
  ['#29c5f6', 'Sky Cyan'],
];

// SteamGridDB lookups are slow (each is a network round trip to
// steamgriddb.com), and the same game gets looked up repeatedly — Change
// Icon then Change Grid then Change Banner all search for the same game
// name, and reopening a picker re-fetches the same art list. Cache both
// steps in memory for the session so only the first lookup per game (or
// per game+kind) pays the network cost.
const sgdbSearchCache = new Map(); // name.trim().toLowerCase() -> {id, name}
const sgdbArtCache = new Map(); // `${gameId}:${kind}` -> grids array

let clockInterval = null;
let screenInterval = null;
let currentKeyHandler = null;
let modalOpen = false;
let fontStyleEl = null;

function joinPath(...parts) {
  return parts.join('/').replace(/\/+/g, '/');
}

// Every icon/banner/font path from main.js is a native OS path — on
// Windows that's backslash-separated and drive-lettered (e.g.
// "C:\Users\Name\...\icon.png"), which 'file://' + encodeURI(p) turns
// into an unparseable URL (backslashes get percent-encoded instead of
// treated as separators, and there's no leading slash before the drive
// letter for the required file:///C:/... form). Mac/Linux paths already
// start with '/', so this is a no-op there — only Windows was broken.
function fileUrl(p) {
  let pathName = p.replace(/\\/g, '/');
  if (!pathName.startsWith('/')) pathName = '/' + pathName;
  return 'file://' + encodeURI(pathName);
}

function formatClock(tz) {
  const opts = { hour: '2-digit', minute: '2-digit', hour12: state.timeFormat === '12h' };
  if (state.showSeconds) opts.second = '2-digit';
  const zone = tz !== undefined ? tz : state.timezone;
  if (zone) opts.timeZone = zone;
  return new Intl.DateTimeFormat('en-US', opts).format(new Date());
}

// Offset of an IANA zone from UTC, in minutes, at this instant (DST-aware).
// null/undefined means "system default zone".
function tzOffsetMinutes(tz) {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || undefined, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  // Midnight-24h rolls "24" back to "00" in some locales' formatToParts output.
  const hour = parts.hour === '24' ? '0' : parts.hour;
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
  return Math.round((asUTC - now.getTime()) / 60000);
}

// Human label for how far `tz` is from `baseTz` right now, e.g. "+3h", "-30m", "Same time".
function zoneDiffLabel(tz, baseTz) {
  const diff = tzOffsetMinutes(tz) - tzOffsetMinutes(baseTz);
  if (diff === 0) return 'Same time';
  const sign = diff > 0 ? '+' : '-';
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
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

// Each imported font remembers its own scale (state.customFonts[].scale) —
// different font files render at very different apparent sizes for the
// same nominal font-size, so this multiplies on top of the Small/Medium/
// Large preset (see body's zoom calc() in style.css) rather than being
// just one more global size knob.
function applyCustomFontScale(scale) {
  document.documentElement.style.setProperty('--font-scale', String(scale || 1));
}

async function persistDisplaySettings() {
  await window.api.saveDisplaySettings({
    fontPath: state.fontPath,
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
    timezone: state.timezone,
    timeFormat: state.timeFormat,
    showSeconds: state.showSeconds,
  });
}

/* ---------- keyboard nav ---------- */

window.addEventListener('keydown', (e) => {
  if (modalOpen) return;
  if (currentKeyHandler) currentKeyHandler(e);
});

/* ---------- responsive re-layout ---------- */

// CSS alone (clamp()/auto-fill) handles most of "fit the window", but
// screens with JS-computed layout — the settings grid's nav column count,
// chiefly — need a rebuild when the window actually changes size, not just
// a style recalculation. Debounced so a drag-resize doesn't re-render on
// every intermediate pixel, only once it settles.
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (modalOpen) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => render(), 150);
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
function createNav(items, { onEscape, vertical = false, onFocus, initialIndex = 0 } = {}) {
  let index = items.length ? Math.max(0, Math.min(items.length - 1, initialIndex)) : 0;
  function apply() {
    items.forEach((it, i) => it.el.classList.toggle('kbd-focus', i === index));
    // Follows the focused item into view when a list overflows its
    // container — 'nearest' only scrolls if it's actually off-screen, so
    // this is a no-op (no jitter) when everything already fits.
    items[index]?.el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    // Keeps real DOM focus in sync with the visual highlight — a no-op for
    // plain divs (tiles, rows), but matters for actual <button> elements
    // (modal dialogs): without this, moving the highlight left the native
    // focus ring behind on whichever button got an explicit .focus() call
    // at mount, so two different buttons looked focused at once.
    items[index]?.el.focus?.();
    if (onFocus && items[index]) onFocus(items[index], index);
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
    items[index]?.el.focus?.();
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

// For screens mixing single-item rows (a form row, a list row) with
// horizontal button groups (24-hour/12-hour, Off/On, Small/Medium/Large) —
// unlike create2DNav's uniform grid, each row here can hold a different
// number of items. Up/Down moves between rows (clamping the column to
// whatever the new row has); Left/Right moves within the current row and
// is a harmless no-op on a single-item row, so a horizontal pair is
// actually reachable with Left/Right instead of only responding to Up/Down
// as if it were just another vertical list entry.
function createRowNav(rows, { onEscape } = {}) {
  let row = 0;
  let col = 0;
  function currentRow() {
    return rows[row] || [];
  }
  function apply() {
    rows.forEach((r, ri) => r.forEach((it, ci) => it.el.classList.toggle('kbd-focus', ri === row && ci === col)));
    const cur = currentRow()[col];
    cur?.el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    cur?.el.focus?.();
  }
  if (rows.length && rows[0].length) apply();
  function moveRow(delta) {
    if (!rows.length) return;
    row = Math.max(0, Math.min(rows.length - 1, row + delta));
    col = Math.min(col, Math.max(0, currentRow().length - 1));
    apply();
  }
  function moveCol(delta) {
    const r = currentRow();
    if (r.length < 2) return;
    col = Math.max(0, Math.min(r.length - 1, col + delta));
    apply();
  }
  function activate() {
    currentRow()[col]?.activate();
  }
  function handleKey(e) {
    switch (e.key) {
      case 'ArrowDown': moveRow(1); e.preventDefault(); break;
      case 'ArrowUp': moveRow(-1); e.preventDefault(); break;
      case 'ArrowRight': moveCol(1); e.preventDefault(); break;
      case 'ArrowLeft': moveCol(-1); e.preventDefault(); break;
      case 'Enter':
      case ' ': activate(); e.preventDefault(); break;
      case 'Escape': if (onEscape) { onEscape(); e.preventDefault(); } break;
      default: break;
    }
  }
  return { handleKey, activate };
}

// The settings grid's CSS (repeat(auto-fill, ...)) wraps to however many
// columns actually fit the window, so 2D nav can't assume a fixed column
// count — this measures it from the real, already-laid-out DOM (items
// sharing the first item's offsetTop are on its row) instead of
// recomputing the same width math CSS already did.
function countGridColumns(items) {
  if (!items.length) return 1;
  const firstTop = items[0].el.offsetTop;
  let cols = 0;
  for (const it of items) {
    if (it.el.offsetTop === firstTop) cols++;
    else break;
  }
  return cols || 1;
}

/* ---------- modals ---------- */

// `hints` replaces the footer bar's content for as long as this modal is
// open (restored on close) — the underlying screen's hints (e.g. "Enter
// Select") describe its own list, not the dialog now covering it.
function openModal(build, { wide = false, hints } = {}) {
  return new Promise((resolve) => {
    modalOpen = true;
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = wide ? 'modal wide' : 'modal';
    backdrop.appendChild(modal);

    const footer = document.getElementById('footer-hints');
    const previousHintsHTML = footer.innerHTML;
    if (hints) setHints(hints);

    function close(value) {
      modalOpen = false;
      root.innerHTML = '';
      footer.innerHTML = previousHintsHTML;
      resolve(value);
    }

    backdrop.addEventListener('keydown', (e) => e.stopPropagation());
    build(modal, close);
    root.appendChild(backdrop);
  });
}

function showPrompt(title, label, initialValue) {
  return openModal((modal, close) => {
    const h = document.createElement('h3');
    h.textContent = title;
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
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

    cancelBtn.onclick = () => close(null);
    okBtn.onclick = () => close(input.value.trim() || null);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter') close(input.value.trim() || null);
    });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }, { hints: [{ key: 'Enter', label: 'OK' }, { key: 'Esc', label: 'Cancel' }] });
}

// Enter/Escape still work as shortcuts (Escape = Cancel, matching every
// other screen's Back convention), but Cancel/Confirm are also a real
// Left/Right-navigable list with a visible focus ring on both buttons —
// without that, only Confirm ever showed as focused and Cancel was a
// mouse-only dead end, even though Escape happened to reach it.
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

    const items = [
      { el: noBtn, activate: () => close(false) },
      { el: yesBtn, activate: () => close(true) },
    ];
    const nav = createNav(items, { onEscape: () => close(false), initialIndex: 1 });
    modal.parentElement.addEventListener('keydown', (e) => nav.handleKey(e));
    setTimeout(() => yesBtn.focus(), 0);
  }, { hints: [{ key: '←→', label: 'Choose' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Cancel' }] });
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
    const nav = createNav([{ el: okBtn, activate: () => close() }], { onEscape: () => close() });
    modal.parentElement.addEventListener('keydown', (e) => nav.handleKey(e));
    setTimeout(() => okBtn.focus(), 0);
  }, { hints: [{ key: 'Enter', label: 'OK' }] });
}

// Generic small choice modal — options: [{label, value, primary}]. Buttons
// are a horizontal list, so it uses the same createNav (Left/Right + Enter)
// every other on-screen list uses — a gamepad/keyboard user can pick any
// option here, not just click one with a mouse.
function showChoice(title, message, options) {
  return openModal((modal, close) => {
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = message;
    const buttons = document.createElement('div');
    buttons.className = 'modal-buttons';
    const btnItems = [];
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.textContent = opt.label;
      btn.className = opt.primary ? 'primary' : 'secondary';
      btn.onclick = () => close(opt.value);
      buttons.appendChild(btn);
      btnItems.push({ el: btn, activate: () => close(opt.value) });
    });
    modal.append(h, p, buttons);

    const nav = createNav(btnItems, { onEscape: () => close(null) });
    modal.parentElement.addEventListener('keydown', (e) => nav.handleKey(e));
    setTimeout(() => btnItems[0]?.el.focus(), 0);
  }, { hints: [{ key: '←→', label: 'Choose' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Cancel' }] });
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

function showArtPicker(gameName, grids, kind = 'banner') {
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
      // Icons are square, Grids are portrait (Steam's tall capsule art),
      // Banners are wide (SteamGridDB's Hero asset) — each gets a thumb
      // shaped like what it actually is, instead of squashing/stretching
      // it into a box built for a different aspect ratio.
      img.className = 'art-thumb' + (kind === 'icon' ? ' art-thumb-icon' : kind === 'banner' ? ' art-thumb-banner' : '');
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

    // Matches .art-grid's actual visual layout: 3 columns normally, but
    // banner thumbs are full-width rows (see .art-thumb-banner), so that
    // kind navigates as a single column instead.
    const items = thumbItems.concat([{ el: skipBtn, activate: () => close(null) }]);
    const nav = create2DNav(items, kind === 'banner' ? 1 : 3, { onEscape: () => close(null) });
    modal.parentElement.addEventListener('keydown', (e) => nav.handleKey(e));
  }, { wide: true, hints: [{ key: '↑↓←→', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Skip' }] });
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

const ART_KIND_LABEL = { icon: 'Icon', grid: 'Grid', banner: 'Banner' };

// Looks up art for a game on SteamGridDB. kind is 'icon', 'grid', or
// 'banner' — three distinct SteamGridDB asset types (Icons, Grids, Heroes),
// not one image reused for two purposes. Returns a local file path on
// success, or null on any failure (no key, no results, download error) —
// every caller treats null as "no change", so a SteamGridDB hiccup never
// blocks the surrounding flow.
async function pickSteamGridDbArt(name, appPath, kind = 'banner') {
  const key = await window.api.getSteamGridDbKey();
  if (!key) return null;

  const searchKey = name.trim().toLowerCase();
  let match = sgdbSearchCache.get(searchKey);
  if (!match) {
    let hideLoading = showLoadingModal(`Searching SteamGridDB for "${name}"…`);
    const searchRes = await window.api.steamGridDbSearch(name);
    hideLoading();
    if (!searchRes.ok || !searchRes.results.length) return null;
    match = searchRes.results[0];
    sgdbSearchCache.set(searchKey, match);
  }

  const artCacheKey = `${match.id}:${kind}`;
  let grids = sgdbArtCache.get(artCacheKey);
  if (!grids) {
    const hideLoading = showLoadingModal(`Fetching ${ART_KIND_LABEL[kind].toLowerCase()} options…`);
    const fetchFn = kind === 'icon' ? window.api.steamGridDbIcons
      : kind === 'grid' ? window.api.steamGridDbGrids
      : window.api.steamGridDbHeroes;
    const gridsRes = await fetchFn(match.id);
    hideLoading();
    if (!gridsRes.ok || !gridsRes.grids.length) return null;
    grids = gridsRes.grids;
    sgdbArtCache.set(artCacheKey, grids);
  }

  const chosenUrl = await showArtPicker(match.name, grids, kind);
  if (!chosenUrl) return null;

  hideLoading = showLoadingModal('Downloading…');
  const dl = await window.api.steamGridDbDownload({ url: chosenUrl, appPath, kind });
  hideLoading();
  return dl.ok ? dl.path : null;
}

// Shared by Update Game's Change Icon / Change Grid / Change Banner rows
// and Add Game. Returns undefined for "no change" (user cancelled) vs a
// string path.
async function pickImageFor(kind, gameName, appPath) {
  const choice = await showChoice(
    `Change ${ART_KIND_LABEL[kind]}`,
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

// Persistent header used by every screen: player icon+name (click to open
// Update Player), clock, a settings-gear shortcut, and power. Sub-screens
// show their own heading in the body via buildScreenTitle instead of the
// header changing.
//
// The Settings/Power icons are a mouse convenience layered on top of, not
// instead of, the sidebar's own Settings/Quit entries (see renderMenu) —
// those stay the authoritative controller/keyboard-reachable path (every
// screen's nav already reaches Settings, and Quit from the home screen),
// so adding mouse-clickable header icons here doesn't reintroduce the
// mouse-only dead end the header deliberately avoided before.
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
  const playerBox = document.createElement('div');
  playerBox.className = 'header-player-box';
  const playerName = document.createElement('div');
  playerName.className = 'header-player-name';
  playerName.textContent = state.user.name;
  playerBox.appendChild(playerName);
  const goUpdateUser = () => { ui.screen = 'updateUser'; render(); };
  playerIcon.addEventListener('click', goUpdateUser);
  playerBox.addEventListener('click', goUpdateUser);
  left.append(playerIcon, playerBox);

  const right = document.createElement('div');
  right.className = 'header-right';

  const clock = document.createElement('div');
  clock.className = 'clock';
  clock.textContent = formatClock();
  clockInterval = setInterval(() => { clock.textContent = formatClock(); }, 1000);

  const settingsBtn = document.createElement('div');
  settingsBtn.className = 'header-icon-btn';
  settingsBtn.title = 'Settings';
  settingsBtn.textContent = '⚙';
  settingsBtn.addEventListener('click', () => { ui.screen = 'settings'; render(); });

  const powerBtn = document.createElement('div');
  powerBtn.className = 'header-icon-btn header-power-btn';
  powerBtn.title = 'Quit';
  powerBtn.textContent = '⏻';
  powerBtn.addEventListener('click', async () => {
    if (await showConfirm('Quit', 'Quit the launcher?', 'Quit')) window.api.quit();
  });

  right.append(clock, settingsBtn, powerBtn);
  header.append(left, right);
  return header;
}

/* ---------- central render ---------- */

function render() {
  clearInterval(clockInterval);
  clearInterval(screenInterval);
  screenInterval = null;
  currentKeyHandler = null;
  const appEl = document.getElementById('app');
  appEl.innerHTML = '';
  if (ui.screen === 'menu') renderMenu(appEl);
  else if (ui.screen === 'settings') renderSettings(appEl);
  else if (ui.screen === 'remove') renderRemove(appEl);
  else if (ui.screen === 'color') renderColor(appEl);
  else if (ui.screen === 'updateGamePick') renderUpdateGamePick(appEl);
  else if (ui.screen === 'updateGameEdit') renderUpdateGameEdit(appEl);
  else if (ui.screen === 'updateUser') renderUpdateUser(appEl);
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
  else if (entry.kind === 'updateUser') { ui.screen = 'updateUser'; render(); }
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
  const iconPath = await pickImageFor('icon', name, chosen);
  const gridPath = await pickImageFor('grid', name, chosen);
  const bannerPath = await pickImageFor('banner', name, chosen);
  state.apps = await window.api.addApp({ name, path: chosen, iconPath, gridPath, bannerPath });
  render();
}

/* ---------- update user: pick what to change, then edit just that ---------- */

// Unlike the old flow (which always asked for a new name AND a new icon,
// every time), this screen lists Name/Icon as separate rows — the same
// "row shows current value, click/Enter edits just that field" pattern as
// Update Game — so choosing to change one never forces a decision on the
// other, and it's always visible what the current value is before you
// change it.
function renderUpdateUser(appEl) {
  const header = buildHeader();
  const body = document.createElement('div');
  body.className = 'subscreen-body';
  body.appendChild(buildScreenTitle('Update Player'));
  const subtitle = document.createElement('div');
  subtitle.className = 'screen-subtitle';
  subtitle.textContent = 'Choose what to change — everything else stays the same.';
  body.appendChild(subtitle);

  const form = document.createElement('div');
  form.className = 'update-form';

  const nameRow = document.createElement('div');
  nameRow.className = 'update-row';
  const nameLabel = document.createElement('div');
  nameLabel.className = 'update-row-label';
  nameLabel.textContent = 'Name';
  const nameVal = document.createElement('div');
  nameVal.className = 'update-row-value';
  nameVal.textContent = state.user.name;
  nameRow.append(nameLabel, nameVal);
  const doChangeName = async () => {
    const name = await showPrompt('Change Name', 'Player name:', state.user.name);
    if (!name) return;
    state.user = await window.api.updateUser({ name });
    render();
  };
  nameRow.addEventListener('click', doChangeName);

  const iconRow = document.createElement('div');
  iconRow.className = 'update-row';
  const iconLabel = document.createElement('div');
  iconLabel.className = 'update-row-label';
  iconLabel.textContent = 'Icon';
  const iconVal = document.createElement('div');
  iconVal.className = 'update-row-value';
  iconVal.textContent = state.user.iconPath ? 'Set' : '(none)';
  iconRow.append(iconLabel, iconVal);
  const doChangeIcon = async () => {
    const picked = await window.api.chooseImagePath();
    if (!picked) return;
    state.user = await window.api.updateUser({ iconPath: picked });
    render();
  };
  iconRow.addEventListener('click', doChangeIcon);

  form.append(nameRow, iconRow);

  const goBack = () => { ui.screen = 'settings'; render(); };
  const backBtn = document.createElement('div');
  backBtn.className = 'detail-btn secondary';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', goBack);

  body.append(form, backBtn);
  appEl.append(header, body);

  const items = [
    { el: nameRow, activate: doChangeName },
    { el: iconRow, activate: doChangeIcon },
    { el: backBtn, activate: goBack },
  ];
  const nav = createNav(items, { vertical: true, onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '↑↓', label: 'Navigate' }, { key: 'Enter', label: 'Change' }, { key: 'Esc', label: 'Back' }]);
}

// Home screen: sidebar + a live detail pane, side by side on one screen —
// hovering or keyboard-focusing a game updates the pane in place, no screen
// transition. Selecting (click/Enter) a game launches it directly; the
// pane's own Play/Cancel buttons mirror that for mouse users. Settings and
// Quit stay in the same list (keyboard/gamepad-reachable), unaffected by
// which game the pane happens to be showing.
function renderMenu(appEl) {
  const header = buildHeader();

  const body = document.createElement('div');
  body.className = 'body';

  const entries = state.apps.map((a) => ({ kind: 'game', ...a }))
    .concat([{ kind: 'settings', name: 'Settings' }, { kind: 'quit', name: 'Quit' }]);

  const firstGame = entries.find((e) => e.kind === 'game');
  if (!entries.some((e) => e.kind === 'game' && e.slug === ui.selectedSlug)) {
    ui.selectedSlug = firstGame ? firstGame.slug : null;
  }

  const detailPane = buildDetailPane();
  fillDetailPane(detailPane, entries.find((e) => e.kind === 'game' && e.slug === ui.selectedSlug));

  // Selecting a game (click, hover, or keyboard/gamepad focus) only
  // previews it in the detail pane now — launching requires the Play
  // button specifically, so the icon/row itself is never a launch
  // shortcut. Settings/Quit are unaffected: selecting those still acts
  // immediately, same as before.
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
    if (zone === 'play') focusList();
    selectEntry(entry);
  });

  // Keeps the previewed game's row highlighted persistently (Steam
  // library-style), not just while the pointer/keyboard focus is on it.
  function selectEntry(entry) {
    if (entry.kind !== 'game') return;
    ui.selectedSlug = entry.slug;
    fillDetailPane(detailPane, entry);
    items.forEach((item, i) => {
      const e = entries[i];
      item.el.classList.toggle('selected', e.kind === 'game' && e.slug === entry.slug);
    });
  }

  items.forEach((item, i) => {
    const entry = entries[i];
    if (entry.kind !== 'game') return;
    item.el.classList.toggle('selected', entry.slug === ui.selectedSlug);
    item.el.addEventListener('mouseenter', () => {
      if (zone === 'play') focusList();
      selectEntry(entry);
    });
  });

  body.append(listEl, detailPane);
  appEl.append(header, body);

  // Two nav zones: the sidebar list, and the detail pane's Play button.
  // ArrowRight/Enter on a game row moves focus onto Play (mirroring "click
  // Play" for keyboard/gamepad, not "click the icon"); ArrowLeft/Escape
  // from Play returns to the list. Settings/Quit rows are untouched by
  // this — Enter still acts on them immediately, same as always.
  let zone = 'list';

  // Takes an explicit index rather than reading listNav.getIndex() — this
  // is called from onFocus, which createNav invokes synchronously during
  // its own construction (before the `const listNav` assignment below has
  // completed), so listNav isn't safe to reference from in here.
  function hintsForIndex(i) {
    const focused = entries[i];
    const hints = [{ key: '↑↓', label: 'Navigate' }];
    if (focused?.kind === 'game') hints.push({ key: '→', label: 'Play' });
    hints.push({ key: 'Enter', label: 'Select' });
    return hints;
  }

  function playButtonEl() {
    return detailPane.querySelector('.detail-btn.primary');
  }

  function focusPlay() {
    const btn = playButtonEl();
    if (!btn) return;
    zone = 'play';
    btn.classList.add('kbd-focus');
    setHints([{ key: '←', label: 'Back' }, { key: 'Enter', label: 'Play' }]);
  }

  function focusList() {
    zone = 'list';
    const btn = playButtonEl();
    if (btn) btn.classList.remove('kbd-focus');
    setHints(hintsForIndex(listNav.getIndex()));
  }

  const initialIndex = entries.findIndex((e) => e.kind === 'game' && e.slug === ui.selectedSlug);
  const listNav = createNav(items, {
    vertical: true,
    initialIndex: initialIndex >= 0 ? initialIndex : 0,
    onFocus: (_item, i) => {
      selectEntry(entries[i]);
      if (zone === 'list') setHints(hintsForIndex(i));
    },
  });

  currentKeyHandler = (e) => {
    if (zone === 'play') {
      if (e.key === 'ArrowLeft' || e.key === 'Escape') { focusList(); e.preventDefault(); return; }
      if (e.key === 'Enter' || e.key === ' ') {
        const entry = entries.find((en) => en.kind === 'game' && en.slug === ui.selectedSlug);
        if (entry) launchGame(entry);
        e.preventDefault();
        return;
      }
      return;
    }
    const focused = entries[listNav.getIndex()];
    if ((e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') && focused?.kind === 'game') {
      focusPlay();
      e.preventDefault();
      return;
    }
    listNav.handleKey(e);
  };

  focusList();
}

// Builds the detail pane's stable container once per renderMenu call;
// fillDetailPane() below repopulates its content on every hover/focus
// change without recreating the pane element itself.
function buildDetailPane() {
  const pane = document.createElement('div');
  pane.className = 'detail-pane';
  return pane;
}

let detailResizeObserver = null;

function fillDetailPane(pane, entry) {
  pane.innerHTML = '';
  if (detailResizeObserver) {
    detailResizeObserver.disconnect();
    detailResizeObserver = null;
  }
  if (!entry) return;

  // Grid and banner as their own boxes side by side (grid left, banner
  // right) — the app's own icon (already shown next to the game in the
  // sidebar list) doesn't repeat here; this row is SteamGridDB's other two
  // asset types, Grid and Hero.
  const topRow = document.createElement('div');
  topRow.className = 'detail-top-row';

  const gridBox = document.createElement('div');
  gridBox.className = 'detail-grid-box';
  if (entry.gridPath) {
    const img = document.createElement('img');
    img.src = fileUrl(entry.gridPath);
    img.alt = entry.name;
    gridBox.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className = 'letter';
    span.textContent = (entry.name[0] || '?').toUpperCase();
    gridBox.appendChild(span);
  }

  const bannerBox = document.createElement('div');
  bannerBox.className = 'detail-banner-box';
  if (entry.bannerPath) {
    const bannerImg = document.createElement('img');
    bannerImg.src = fileUrl(entry.bannerPath);
    bannerImg.alt = entry.name;
    bannerBox.appendChild(bannerImg);
  }

  topRow.append(gridBox, bannerBox);

  // The grid box is a fixed 2:3 portrait and the banner box a fixed ~3.1:1
  // landscape — at a shared row height those two ratios naturally render at
  // different heights (banner's width is capped by the remaining row space,
  // which caps its height too). Lock the grid box to the banner's actual
  // height instead of the row's, so their tops and bottoms line up. Read
  // getComputedStyle rather than getBoundingClientRect: the app's text-size
  // setting uses CSS zoom, which getBoundingClientRect reports post-zoom —
  // feeding that straight into style.height would zoom it a second time.
  detailResizeObserver = new ResizeObserver(() => {
    gridBox.style.height = getComputedStyle(bannerBox).height;
  });
  detailResizeObserver.observe(bannerBox);

  const metaRow = document.createElement('div');
  metaRow.className = 'detail-meta-row';
  const titleEl = document.createElement('div');
  titleEl.className = 'detail-title';
  titleEl.textContent = entry.name;
  const playtimeEl = document.createElement('div');
  playtimeEl.className = 'detail-playtime';
  playtimeEl.textContent = formatPlaytime(entry.playtimeSeconds);
  metaRow.append(titleEl, playtimeEl);

  const actions = document.createElement('div');
  actions.className = 'detail-actions';
  const playBtn = document.createElement('div');
  playBtn.className = 'detail-btn primary';
  playBtn.textContent = 'Play';
  playBtn.addEventListener('click', () => launchGame(entry));
  actions.append(playBtn);

  pane.append(topRow, metaRow, actions);
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
  const nav = create2DNav(items, countGridColumns(items), { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '↑↓←→', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }]);
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
    }
  }

  const fieldRows = [
    { label: 'Name', value: entry.name, key: 'name' },
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

  const gridRow = document.createElement('div');
  gridRow.className = 'update-row';
  const gridLabel = document.createElement('div');
  gridLabel.className = 'update-row-label';
  gridLabel.textContent = 'Grid';
  const gridVal = document.createElement('div');
  gridVal.className = 'update-row-value';
  gridVal.textContent = entry.gridPath ? 'Set' : '(none)';
  gridRow.append(gridLabel, gridVal);
  const doChangeGrid = async () => {
    const result = await pickImageFor('grid', entry.name, entry.path);
    if (result !== undefined) {
      state.apps = await window.api.updateApp({ slug: entry.slug, gridPath: result });
      render();
    }
  };
  gridRow.addEventListener('click', doChangeGrid);

  form.append(iconRow, gridRow, bannerRow);

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
    { el: gridRow, activate: doChangeGrid },
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
  importRow.textContent = 'Import Font File…';
  importRow.addEventListener('click', async () => {
    const picked = await window.api.chooseFontPath();
    if (!picked) return;
    applyCustomFont(picked.path, 'CustomUserFont');
    applyCustomFontScale(1); // a freshly imported font always starts at its own 100%
    state.fontPath = picked.path;
    state.fontFamily = 'CustomUserFont';
    state.customFonts = picked.customFonts;
    render();
  });

  const resetRow = document.createElement('div');
  resetRow.className = 'update-row';
  resetRow.textContent = 'Reset to Default Font';
  resetRow.addEventListener('click', async () => {
    applyCustomFont(null, null);
    applyCustomFontScale(1);
    state.fontPath = null;
    state.fontFamily = null;
    await persistDisplaySettings();
    render();
  });

  form.append(importRow, resetRow);

  // Every font ever imported stays listed here (stored in the app's own
  // data dir — see main.js's choose-font-path), so switching back to one
  // used before is a click on its row, not another trip through the file
  // browser to find that file again.
  const fontListLabel = document.createElement('div');
  fontListLabel.className = 'screen-subtitle';
  fontListLabel.textContent = 'Imported Fonts';
  fontListLabel.style.margin = '16px 0 0 10px';

  // Windows font_path uses backslashes (path.join on the main-process
  // side), so a plain endsWith('/'+fileName) would never match there —
  // compare basenames on either separator instead.
  const activeFontFileName = state.fontPath ? state.fontPath.split(/[\\/]/).pop() : null;

  const fontList = document.createElement('div');
  fontList.className = 'timezone-list';
  const fontRows = state.customFonts.map((font) => {
    const isActive = font.fileName === activeFontFileName;
    const row = document.createElement('div');
    row.className = 'timezone-row' + (isActive ? ' active' : '');
    const name = document.createElement('div');
    name.className = 'timezone-row-name';
    name.textContent = font.displayName;
    const status = document.createElement('div');
    status.className = 'timezone-row-diff';
    status.textContent = isActive ? 'Active' : 'Select';
    const removeBtn = document.createElement('div');
    removeBtn.className = 'timezone-row-diff';
    removeBtn.textContent = 'Remove';
    removeBtn.style.cursor = 'pointer';
    row.append(name, status, removeBtn);
    const activateFont = async () => {
      const data = await window.api.selectFont(font.fileName);
      applyCustomFont(data.fontPath, data.fontFamily);
      applyCustomFontScale(font.scale || 1);
      state.fontPath = data.fontPath;
      state.fontFamily = data.fontFamily;
      state.customFonts = data.customFonts;
      render();
    };
    row.addEventListener('click', activateFont);
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const data = await window.api.removeFont(font.fileName);
      if (!data.fontPath) { applyCustomFont(null, null); applyCustomFontScale(1); }
      state.fontPath = data.fontPath;
      state.fontFamily = data.fontFamily;
      state.customFonts = data.customFonts;
      render();
    });
    fontList.appendChild(row);
    return { el: row, activate: activateFont };
  });
  if (!state.customFonts.length) {
    const empty = document.createElement('div');
    empty.className = 'game-list-empty';
    empty.textContent = 'No fonts imported yet.';
    fontList.appendChild(empty);
  }

  // Only shown for an active custom font — the default UI font doesn't
  // have this problem since every size in this app was tuned against it.
  const activeFontEntry = state.customFonts.find((f) => f.fileName === activeFontFileName);
  let scaleLabel = null;
  let scaleRow = null;
  let scaleBtns = [];
  if (activeFontEntry) {
    const currentScale = activeFontEntry.scale || 1;
    scaleLabel = document.createElement('div');
    scaleLabel.className = 'screen-subtitle';
    scaleLabel.textContent = `Font Scale — ${activeFontEntry.displayName} at ${Math.round(currentScale * 100)}%`;
    scaleLabel.style.margin = '16px 0 0 10px';

    scaleRow = document.createElement('div');
    scaleRow.className = 'size-options';
    const adjustScale = async (delta) => {
      const newScale = Math.round(Math.max(0.7, Math.min(2, currentScale + delta)) * 10) / 10;
      const data = await window.api.setFontScale({ fileName: activeFontEntry.fileName, scale: newScale });
      applyCustomFontScale(newScale);
      state.customFonts = data.customFonts;
      render();
    };
    const minusBtn = document.createElement('div');
    minusBtn.className = 'option-btn';
    minusBtn.textContent = '− Smaller';
    minusBtn.addEventListener('click', () => adjustScale(-0.1));
    const plusBtn = document.createElement('div');
    plusBtn.className = 'option-btn';
    plusBtn.textContent = '+ Bigger';
    plusBtn.addEventListener('click', () => adjustScale(0.1));
    scaleRow.append(minusBtn, plusBtn);
    scaleBtns = [minusBtn, plusBtn];
  }

  const sizeLabel = document.createElement('div');
  sizeLabel.className = 'screen-subtitle';
  sizeLabel.textContent = `Text Size — currently ${state.fontSize[0].toUpperCase()}${state.fontSize.slice(1)}`;
  sizeLabel.style.margin = '16px 0 0 10px';

  const sizeRow = document.createElement('div');
  sizeRow.className = 'size-options';
  const sizeBtns = ['small', 'medium', 'large'].map((size) => {
    const btn = document.createElement('div');
    btn.className = 'option-btn' + (state.fontSize === size ? ' active' : '');
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

  body.append(form, fontListLabel, fontList);
  if (scaleLabel) body.append(scaleLabel, scaleRow);
  body.append(sizeLabel, sizeRow, backBtn);
  appEl.append(header, body);

  // Small/Medium/Large (and, when shown, −/+ Font Scale) are each a
  // horizontal group (Left/Right); everything else is its own row
  // (Up/Down) — see createRowNav.
  const rows = [
    [{ el: importRow, activate: () => importRow.click() }],
    [{ el: resetRow, activate: () => resetRow.click() }],
    ...fontRows.map((r) => [r]),
    ...(scaleBtns.length ? [scaleBtns.map((b) => ({ el: b, activate: () => b.click() }))] : []),
    sizeBtns.map((b) => ({ el: b, activate: () => b.click() })),
    [{ el: backBtn, activate: goBack }],
  ];
  const nav = createRowNav(rows, { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '↑↓', label: 'Navigate' }, { key: '←→', label: 'Choose' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }]);
}

/* ---------- time settings ---------- */

function renderTime(appEl) {
  const header = buildHeader();
  const body = document.createElement('div');
  body.className = 'subscreen-body';
  body.appendChild(buildScreenTitle('Time Setting'));
  const subtitle = document.createElement('div');
  subtitle.className = 'screen-subtitle';
  subtitle.textContent = `Currently showing: ${state.timezone || 'System Default'} — ${formatClock(state.timezone)}`;
  body.appendChild(subtitle);

  const formatRow = document.createElement('div');
  formatRow.className = 'size-options';
  const formatBtns = ['24h', '12h'].map((fmt) => {
    const btn = document.createElement('div');
    btn.className = 'option-btn' + (state.timeFormat === fmt ? ' active' : '');
    btn.textContent = fmt === '24h' ? '24-hour' : '12-hour';
    btn.addEventListener('click', async () => {
      state.timeFormat = fmt;
      await persistDisplaySettings();
      render();
    });
    formatRow.appendChild(btn);
    return btn;
  });

  const secondsLabel = document.createElement('div');
  secondsLabel.className = 'screen-subtitle';
  secondsLabel.textContent = 'Show Seconds';
  secondsLabel.style.margin = '16px 0 0 10px';

  const secondsRow = document.createElement('div');
  secondsRow.className = 'size-options';
  const secondsBtns = [['off', 'Off'], ['on', 'On']].map(([value, label]) => {
    const btn = document.createElement('div');
    const isActive = state.showSeconds === (value === 'on');
    btn.className = 'option-btn' + (isActive ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      state.showSeconds = value === 'on';
      await persistDisplaySettings();
      render();
    });
    secondsRow.appendChild(btn);
    return btn;
  });

  const list = document.createElement('div');
  list.className = 'timezone-list';
  const zones = ['System Default', ...state.timezones];
  // Each row shows the option's own live clock plus how far it sits from
  // the zone that's actually applied right now (`state.timezone`), so
  // picking a zone is never a guess at what time it'll show.
  const zoneRows = zones.map((tz) => {
    const zoneValue = tz === 'System Default' ? null : tz;
    const isCurrent = zoneValue === state.timezone;
    const row = document.createElement('div');
    row.className = 'timezone-row' + (isCurrent ? ' active' : '');
    const name = document.createElement('div');
    name.className = 'timezone-row-name';
    name.textContent = tz;
    const clock = document.createElement('div');
    clock.className = 'timezone-row-clock';
    const diff = document.createElement('div');
    diff.className = 'timezone-row-diff';
    row.append(name, clock, diff);
    function refreshRow() {
      clock.textContent = formatClock(zoneValue);
      diff.textContent = isCurrent ? 'Current' : zoneDiffLabel(zoneValue, state.timezone);
    }
    refreshRow();
    row.addEventListener('click', async () => {
      state.timezone = zoneValue;
      await persistDisplaySettings();
      render();
    });
    list.appendChild(row);
    return { row, refreshRow };
  });
  screenInterval = setInterval(() => zoneRows.forEach((r) => r.refreshRow()), 1000);

  const goBack = () => { ui.screen = 'settings'; render(); };
  const backBtn = document.createElement('div');
  backBtn.className = 'detail-btn secondary';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', goBack);

  body.append(formatRow, secondsLabel, secondsRow, list, backBtn);
  appEl.append(header, body);

  // 24-hour/12-hour and Off/On are each a horizontal pair (Left/Right);
  // everything else is its own row (Up/Down) — see createRowNav.
  const rows = [
    formatBtns.map((b) => ({ el: b, activate: () => b.click() })),
    secondsBtns.map((b) => ({ el: b, activate: () => b.click() })),
    ...zoneRows.map((r) => [{ el: r.row, activate: () => r.row.click() }]),
    [{ el: backBtn, activate: goBack }],
  ];
  const nav = createRowNav(rows, { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '↑↓', label: 'Navigate' }, { key: '←→', label: 'Choose' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }]);
}

/* ---------- menu color ---------- */

// A tile grid of preset accent swatches, styled like every other tile
// grid in the app (tile-wrap/tile-surface/bubble) instead of a bespoke
// look — reusing that language is what makes this screen feel consistent
// with Settings/Add Game rather than like a separate color-tool bolted on.
function buildColorGrid(entries, onActivate, activeHex, activeMode) {
  const outer = document.createElement('div');
  outer.className = 'settings-grid-outer';
  const grid = document.createElement('div');
  grid.className = 'settings-grid';
  const items = [];
  entries.forEach((entry) => {
    const wrap = document.createElement('div');
    wrap.className = 'tile-wrap';
    const anchor = document.createElement('div');
    anchor.className = 'tile-anchor';
    const surface = document.createElement('div');
    surface.className = 'tile-surface';

    if (entry.kind === 'swatch') {
      surface.style.background = entry.hex;
      if (entry.hex.toLowerCase() === activeHex.toLowerCase()) {
        const check = document.createElement('span');
        check.className = 'color-swatch-check';
        check.style.color = Theme.readableFg(entry.hex);
        check.textContent = '✓';
        surface.appendChild(check);
      }
    } else if (entry.kind === 'mode') {
      const span = document.createElement('span');
      span.className = 'letter';
      span.textContent = entry.mode === 'light' ? '☀️' : '🌙';
      surface.appendChild(span);
      if (entry.mode === activeMode) {
        const check = document.createElement('span');
        // Not .color-swatch-check: this tile's background is --tile
        // (near-white in Light Mode), not an arbitrary hex, so it just
        // reuses the existing --tile-fg variable instead of computing
        // readableFg itself.
        check.className = 'mode-tile-check';
        check.textContent = '✓';
        surface.appendChild(check);
      }
    } else {
      const span = document.createElement('span');
      span.className = 'letter';
      span.textContent = entry.kind === 'custom' ? '🎨' : '←';
      surface.appendChild(span);
    }
    anchor.appendChild(surface);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const nameEl = document.createElement('div');
    nameEl.className = 'bubble-name';
    nameEl.textContent = entry.name;
    const actionEl = document.createElement('div');
    actionEl.className = 'bubble-action';
    actionEl.textContent = entry.kind === 'back' ? 'Back' : 'Select';
    bubble.append(nameEl, actionEl);
    anchor.appendChild(bubble);

    wrap.appendChild(anchor);
    wrap.addEventListener('click', () => onActivate(entry));
    grid.appendChild(wrap);
    items.push({ el: wrap, activate: () => onActivate(entry) });
  });
  outer.appendChild(grid);
  return { gridEl: outer, items };
}

// R/G/B fine-tuning for a single accent color, for when none of the
// presets are quite right — same slider mechanics the old 3-tab screen
// used, just scoped to one color instead of three independent ones.
function showCustomColorModal(initialHex) {
  return openModal((modal, close) => {
    const h = document.createElement('h3');
    h.textContent = 'Custom Accent Color';
    const preview = document.createElement('div');
    preview.className = 'color-preview';
    const rowsWrap = document.createElement('div');
    rowsWrap.className = 'color-rows';
    const values = Theme.hexToRgb(initialHex);
    let rowIndex = 0;

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

      row.addEventListener('click', () => { rowIndex = i; refresh(); });
      function setFromEvent(e) {
        const rect = bar.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        rowIndex = i;
        values[i] = Math.round((x / rect.width) * 255);
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

    const buttons = document.createElement('div');
    buttons.className = 'modal-buttons';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'secondary';
    const okBtn = document.createElement('button');
    okBtn.textContent = 'Apply';
    okBtn.className = 'primary';
    buttons.append(cancelBtn, okBtn);
    modal.append(h, preview, rowsWrap, buttons);

    function refresh() {
      preview.style.background = Theme.rgbToHex(values);
      rowEls.forEach((r, i) => {
        r.value.textContent = String(values[i]);
        r.fill.style.width = `${(values[i] / 255) * 100}%`;
        r.row.classList.toggle('focused', rowIndex === i);
      });
    }
    refresh();

    cancelBtn.onclick = () => close(null);
    okBtn.onclick = () => close(Theme.rgbToHex(values));
    modal.parentElement.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { rowIndex = (rowIndex - 1 + 3) % 3; refresh(); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { rowIndex = (rowIndex + 1) % 3; refresh(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { values[rowIndex] = Math.max(0, values[rowIndex] - 8); refresh(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { values[rowIndex] = Math.min(255, values[rowIndex] + 8); refresh(); e.preventDefault(); }
      else if (e.key === 'Enter') { close(Theme.rgbToHex(values)); e.preventDefault(); }
      else if (e.key === 'Escape') { close(null); e.preventDefault(); }
    });
    // Without giving something in the modal real DOM focus, document.activeElement
    // stays on <body> — every keydown (real keyboard AND the gamepad code's
    // synthetic dispatch, which also targets document.activeElement) would
    // then bubble up from body, never reaching this modal's own listener,
    // since the backdrop is a descendant of body, not an ancestor.
    setTimeout(() => okBtn.focus(), 0);
  }, { hints: [{ key: '↑↓', label: 'Channel' }, { key: '←→', label: 'Adjust' }, { key: 'Enter', label: 'Apply' }, { key: 'Esc', label: 'Cancel' }] });
}

function renderColor(appEl) {
  const header = buildHeader();
  const body = document.createElement('div');
  body.className = 'subscreen-body';
  body.appendChild(buildScreenTitle('Menu Color'));
  const subtitle = document.createElement('div');
  subtitle.className = 'screen-subtitle';
  subtitle.textContent = `Accent: ${state.themeColor}, ${state.themeMode === 'light' ? 'Light' : 'Dark'} mode — everything else matches automatically.`;
  body.appendChild(subtitle);

  async function applyAccent(hex) {
    await window.api.saveSettings({ themeColor: hex, themeMode: state.themeMode });
    state.themeColor = hex;
    state.theme = Theme.computeTheme(hex, state.themeMode);
    applyTheme();
    render();
  }

  async function applyMode(mode) {
    await window.api.saveSettings({ themeColor: state.themeColor, themeMode: mode });
    state.themeMode = mode;
    state.theme = Theme.computeTheme(state.themeColor, mode);
    applyTheme();
    render();
  }

  async function activateColorEntry(entry) {
    if (entry.kind === 'swatch') {
      await applyAccent(entry.hex);
    } else if (entry.kind === 'mode') {
      await applyMode(entry.mode);
    } else if (entry.kind === 'custom') {
      const hex = await showCustomColorModal(state.themeColor);
      if (hex) await applyAccent(hex);
    } else if (entry.kind === 'back') {
      ui.screen = 'settings';
      render();
    }
  }

  const entries = [
    { kind: 'mode', mode: 'dark', name: 'Dark Mode' },
    { kind: 'mode', mode: 'light', name: 'Light Mode' },
    ...PRESET_ACCENTS.map(([hex, name]) => ({ kind: 'swatch', hex, name })),
    { kind: 'custom', name: 'Custom Color' },
    { kind: 'back', name: 'Back' },
  ];

  const { gridEl, items } = buildColorGrid(entries, activateColorEntry, state.themeColor, state.themeMode);
  body.appendChild(gridEl);
  appEl.append(header, body);

  const goBack = () => { ui.screen = 'settings'; render(); };
  const nav = create2DNav(items, countGridColumns(items), { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);

  setHints([{ key: '↑↓←→', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }]);
}

/* ---------- init ---------- */

async function init() {
  const data = await window.api.getState();
  state.apps = data.apps;
  state.user = data.user;
  state.themeColor = data.themeColor;
  state.themeMode = data.themeMode;
  state.assetsDir = data.assetsDir;
  state.fontPath = data.fontPath;
  state.fontFamily = data.fontFamily;
  state.fontSize = data.fontSize;
  state.customFonts = data.customFonts;
  state.timezone = data.timezone;
  state.timeFormat = data.timeFormat;
  state.timezones = data.timezones;
  state.showSeconds = data.showSeconds;
  state.theme = Theme.computeTheme(state.themeColor, state.themeMode);
  applyTheme();
  if (state.fontPath && state.fontFamily) {
    applyCustomFont(state.fontPath, state.fontFamily);
    const activeFileName = state.fontPath.split(/[\\/]/).pop();
    applyCustomFontScale(state.customFonts.find((f) => f.fileName === activeFileName)?.scale || 1);
  }
  applyFontSize(state.fontSize);

  window.api.onAppsUpdated((apps) => {
    state.apps = apps;
    if (ui.screen === 'menu' || ui.screen === 'detail') render();
  });

  requestAnimationFrame(pollGamepads);
  render();
}

window.addEventListener('DOMContentLoaded', init);
