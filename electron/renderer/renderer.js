const state = {
  apps: [], themeColor: '#0e6cc4', themeMode: 'dark', theme: null,
  user: { name: 'Player', iconPath: null },
  fontPath: null, fontFamily: null, fontSize: 'medium', customFonts: [],
  timezone: null, timeFormat: '24h', timezones: [], showSeconds: false,
  musicPath: null, musicVolume: 0.5, musicMuted: false, customMusic: [],
  uiSounds: { move: null, confirm: null, back: null },
  customUiSounds: { move: [], confirm: [], back: [] },
};
const ui = { screen: 'menu', updateGameSlug: null };

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
const sgdbArtCache = new Map(); // `${gameId}:${kind}` -> gallery (see pickSteamGridDbArt)

let clockInterval = null;
let screenInterval = null;
let currentKeyHandler = null;
let modalOpen = false;
let fontStyleEl = null;

/* ---------- small DOM helpers ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function goTo(screen) {
  ui.screen = screen;
  render();
}

// Line icons (24x24, stroke = currentColor) instead of emoji — emoji render
// differently on every OS and can't pick up the theme's foreground color.
const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  droplet: '<path d="M12 2.7l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  volume: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>',
  sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
};

function iconNode(name, className = 'icon') {
  const span = el('span', className);
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
  return span;
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

// Same Windows-backslash-vs-Mac/Linux-slash split every "is this stored
// path the active one" check needs (font/music/ui-sound path -> fileName).
function baseName(p) {
  return p ? p.split(/[\\/]/).pop() : null;
}

function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}

/* ---------- background music ---------- */

// One looping <audio> element for the whole app session — created once
// (setupBackgroundMusic, called from init) rather than per-render, since
// render() rebuilds the DOM from scratch on every screen change and a
// re-created <audio> would restart the track from 0 each time.
let bgMusicEl = null;

function setupBackgroundMusic() {
  bgMusicEl = new Audio();
  bgMusicEl.loop = true;
  applyMusicSource(state.musicPath);
  applyMusicVolume();
  playBackgroundMusic();
}

function applyMusicSource(musicPath) {
  if (!bgMusicEl) return;
  bgMusicEl.src = musicPath ? fileUrl(musicPath) : '';
  // Reassigning .src to a string equal to its current value is a no-op in
  // Chromium (no reload fires) — e.g. switching straight back to a track
  // that's already active, or any other case where the resolved URL
  // happens to match. .load() unconditionally restarts the resource
  // selection algorithm, so the switch always actually takes effect.
  bgMusicEl.load();
}

// Reads state directly (rather than taking a volume argument) so mute and
// volume can never fall out of sync — every caller that changes either one
// just calls this again instead of having to recompute "muted ? 0 : x" itself.
function applyMusicVolume() {
  if (bgMusicEl) bgMusicEl.volume = state.musicMuted ? 0 : state.musicVolume;
}

function playBackgroundMusic() {
  if (!bgMusicEl || !state.musicPath) return;
  bgMusicEl.play().catch(() => {}); // ignored: e.g. no supported audio device
}

function pauseBackgroundMusic() {
  if (bgMusicEl) bgMusicEl.pause();
}

/* ---------- UI navigation sound effects ---------- */

// Synthesized with the Web Audio API (short oscillator blips) rather than
// shipped audio files — these are built-in app chrome, not user content
// like the background track, so there's nothing to import or store.
//
// Every screen's keyboard/gamepad navigation already funnels through one
// of three shared constructors (createNav/create2DNav/createRowNav below),
// and gamepad input is itself dispatched as a real KeyboardEvent that
// reaches the exact same handleKey code (see dispatchSyntheticKey) — so
// hooking sound into those three functions covers every screen and every
// modal in the app in one place, for both input methods.
let uiAudioCtx = null;
const uiSoundLastPlayed = { move: 0, confirm: 0, back: 0 };
// A physical key held down auto-repeats far faster than these blips are
// meant to be heard (and gamepad repeat is a steady 130ms — see
// GAMEPAD_REPEAT_RATE_MS) — without a floor, holding a direction spams
// overlapping copies of the same tone into a buzz instead of distinct taps.
const UI_SOUND_MIN_GAP_MS = { move: 70, confirm: 150, back: 150 };

// Repeated "move" plays close together (holding a direction, flicking a
// stick) climb in pitch each step — like a scroll wheel or rolodex
// speeding up — instead of every tick sounding identical, which reads as
// one static beep repeating rather than an impression of scrolling.
// Pausing longer than the reset window starts the climb over from 0.
let moveStreak = 0;
let moveStreakLastPlayed = 0;
const MOVE_STREAK_RESET_MS = 400;
const MOVE_STREAK_MAX = 8;

function playUiTone(steps) {
  if (!uiAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    uiAudioCtx = new Ctx();
  }
  if (uiAudioCtx.state === 'suspended') uiAudioCtx.resume().catch(() => {});
  const ctx = uiAudioCtx;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.connect(ctx.destination);
  let t = now;
  for (const { freq, duration, peak } of steps) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.connect(gain);
    // Linear ramp in/out of each note (instead of an on/off step) avoids
    // the sharp click a sudden amplitude jump produces.
    gain.gain.linearRampToValueAtTime(peak, t + duration * 0.15);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    osc.start(t);
    osc.stop(t + duration);
    t += duration;
  }
}

// A user-imported file replaces the synthesized tone for that one kind
// (main.js's choose-ui-sound/remove-ui-sound). One <audio> element per
// kind, reused across plays and rewound to 0 rather than recreated each
// time — recreating it would just be a second way to hit the exact same
// "assigning an unchanged .src is a no-op" pitfall the music track already
// ran into (see applyMusicSource). The element itself is thrown away (not
// just its src updated) whenever the active file for that kind changes, so
// there's nothing stale left playing from the previous import.
const customUiAudioEls = { move: null, confirm: null, back: null };

function resetCustomUiSound(kind) {
  customUiAudioEls[kind] = null;
}

// streak (0..MOVE_STREAK_MAX) nudges the pitch up a notch per step for the
// synthesized tone, or the playback rate for a custom file — playbackRate
// is a crude pitch shift (it also speeds up the sound itself), but it's
// the only lever a plain <audio> element has, and at these small steps it
// reads the same way: each tick in a held scroll sits a bit higher than
// the last.
function playCustomUiSound(kind, streak) {
  let audio = customUiAudioEls[kind];
  if (!audio) {
    audio = new Audio(fileUrl(state.uiSounds[kind]));
    customUiAudioEls[kind] = audio;
  }
  audio.currentTime = 0;
  audio.playbackRate = kind === 'move' ? 1 + streak * 0.06 : 1;
  audio.play().catch(() => {});
}

function playUiSound(kind) {
  const now = performance.now();
  if (now - uiSoundLastPlayed[kind] < UI_SOUND_MIN_GAP_MS[kind]) return;
  uiSoundLastPlayed[kind] = now;

  let streak = 0;
  if (kind === 'move') {
    streak = now - moveStreakLastPlayed < MOVE_STREAK_RESET_MS ? Math.min(MOVE_STREAK_MAX, moveStreak + 1) : 0;
    moveStreak = streak;
    moveStreakLastPlayed = now;
  }

  if (state.uiSounds[kind]) { playCustomUiSound(kind, streak); return; }
  if (kind === 'move') playUiTone([{ freq: 620 + streak * 26, duration: 0.045, peak: 0.16 }]);
  else if (kind === 'confirm') playUiTone([{ freq: 520, duration: 0.055, peak: 0.2 }, { freq: 880, duration: 0.08, peak: 0.2 }]);
  else if (kind === 'back') playUiTone([{ freq: 440, duration: 0.06, peak: 0.18 }, { freq: 300, duration: 0.09, peak: 0.18 }]);
}

// Bypasses the anti-spam throttle above — that gate exists to stop a held
// key/gamepad-repeat from layering the same tone into a buzz, not to limit
// a deliberate, one-off preview click on the Settings screen.
function previewUiSound(kind) {
  uiSoundLastPlayed[kind] = 0;
  playUiSound(kind);
}

/* ---------- formatting ---------- */

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

/* ---------- theme / font ---------- */

function applyTheme() {
  const t = state.theme;
  const root = document.documentElement.style;
  root.setProperty('--bg', t.bg);
  root.setProperty('--glow', t.glow);
  root.setProperty('--tile', t.tile);
  root.setProperty('--tile-overlay', t.tileOverlay);
  root.setProperty('--accent', state.themeColor);
  root.setProperty('--fg', Theme.readableFg(t.bg));
  root.setProperty('--dim-fg', Theme.mix(Theme.readableFg(t.bg), t.bg, 0.45));
  root.setProperty('--tile-fg', Theme.readableFg(t.tile));
  root.setProperty('--accent-fg', Theme.readableFg(state.themeColor));
  document.documentElement.setAttribute('data-mode', state.themeMode);
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
    document.documentElement.style.setProperty('--user-font', `'${family}'`);
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

/* ---------- full-screen backdrop ---------- */

// The focused game's banner fills the screen behind the menu, the way a
// console dashboard swaps its background art as you move along the game
// row. Each change fades a fresh <img> in over the old one (which fades out
// and is then removed) rather than swapping one element's src, which would
// hard-cut instead of crossfading.
let backdropShown = null;
let backdropWanted = null;

function showBackdrop(imagePath) {
  backdropWanted = imagePath || null;
  applyBackdrop();
}

function applyBackdrop() {
  if (backdropWanted === backdropShown) return;
  backdropShown = backdropWanted;
  const root = document.getElementById('backdrop');
  for (const old of root.children) {
    old.classList.remove('shown');
    setTimeout(() => old.remove(), 700);
  }
  if (!backdropShown) return;
  const img = el('img', 'backdrop-img');
  img.alt = '';
  img.onload = () => requestAnimationFrame(() => img.classList.add('shown'));
  img.src = fileUrl(backdropShown);
  root.appendChild(img);
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

function gamepadConnected() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  return Array.from(pads).some((p) => p && p.connected);
}

/* ---------- focus memory + pointer focus (shared by every nav) ---------- */

// Every action on a settings screen re-renders it from scratch (render()
// rebuilds the DOM), which used to drop focus back onto the first row —
// pressing Louder three times meant navigating back down to it three
// times. Each screen's nav now saves its position here and restores it on
// the next render of the same screen, which also means backing out of a
// sub-screen lands on the entry you came from, the way a console menu does.
// Modal navs (created while modalOpen is true) never read or write this —
// they'd otherwise clobber the position of the screen underneath them.
const navMemory = {};

function navMemoryKey() {
  return modalOpen ? null : ui.screen;
}

// The mouse moves the same highlight the keyboard/gamepad does, so there's
// only ever one focused item on screen (previously :hover styled a second,
// unrelated one). Chromium fires mousemove on a *stationary* pointer when
// content scrolls under it, which would let a resting cursor steal focus
// mid keyboard-scroll — so only moves that actually changed the pointer's
// screen position count.
let pointerReallyMoved = false;
let lastPointerX = null;
let lastPointerY = null;
window.addEventListener('mousemove', (e) => {
  pointerReallyMoved = e.screenX !== lastPointerX || e.screenY !== lastPointerY;
  lastPointerX = e.screenX;
  lastPointerY = e.screenY;
}, true);

// Rebinding an element (e.g. the art picker rebuilding its nav after "Load
// more") replaces its handler rather than stacking a second, stale one.
function bindPointerFocus(node, onPoint) {
  if (!node._onPointerFocus) node.addEventListener('mousemove', () => { if (pointerReallyMoved) node._onPointerFocus(); });
  node._onPointerFocus = onPoint;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function revealFocused(node) {
  // 'nearest' only scrolls if it's actually off-screen, so this is a no-op
  // (no jitter) when everything already fits.
  node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  // Keeps real DOM focus in sync with the visual highlight — a no-op for
  // plain divs (tiles, rows), but matters for actual <button> elements
  // (modal dialogs), which otherwise kept a native focus of their own.
  node.focus?.();
}

// 1D nav: horizontal by default (tile strips), or vertical (Up/Down) for
// lists.
function createNav(items, { onEscape, vertical = false, onFocus, initialIndex } = {}) {
  const memoryKey = navMemoryKey();
  const start = initialIndex ?? (memoryKey ? navMemory[memoryKey] : 0) ?? 0;
  let index = clamp(start, 0, Math.max(0, items.length - 1));
  function apply() {
    items.forEach((it, i) => it.el.classList.toggle('kbd-focus', i === index));
    const cur = items[index];
    if (!cur) return;
    revealFocused(cur.el);
    if (memoryKey) navMemory[memoryKey] = index;
    if (onFocus) onFocus(cur, index);
  }
  function focusIndex(i) {
    if (i === index) return;
    index = i;
    apply();
  }
  items.forEach((it, i) => bindPointerFocus(it.el, () => focusIndex(i)));
  if (items.length) apply();
  function move(delta) {
    if (!items.length) return;
    if (items.length > 1) playUiSound('move');
    index = (index + delta + items.length) % items.length;
    apply();
  }
  function activate() {
    if (items.length) { playUiSound('confirm'); items[index].activate(); }
  }
  const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
  function handleKey(e) {
    if (e.key === prevKey) { move(-1); e.preventDefault(); return; }
    if (e.key === nextKey) { move(1); e.preventDefault(); return; }
    if (e.key === 'Enter' || e.key === ' ') { activate(); e.preventDefault(); return; }
    if (e.key === 'Escape' && onEscape) { playUiSound('back'); onEscape(); e.preventDefault(); }
  }
  return { handleKey, move, activate, getIndex: () => index };
}

// 2D grid nav for the Settings / Menu Color grids.
function create2DNav(items, cols, { onEscape, initialIndex } = {}) {
  const memoryKey = navMemoryKey();
  let index = clamp(initialIndex ?? ((memoryKey && navMemory[memoryKey]) || 0), 0, Math.max(0, items.length - 1));
  function apply() {
    items.forEach((it, i) => it.el.classList.toggle('kbd-focus', i === index));
    if (!items[index]) return;
    revealFocused(items[index].el);
    if (memoryKey) navMemory[memoryKey] = index;
  }
  items.forEach((it, i) => bindPointerFocus(it.el, () => { if (i !== index) { index = i; apply(); } }));
  if (items.length) apply();
  function moveTo(newIndex) {
    if (!items.length) return;
    const clamped = clamp(newIndex, 0, items.length - 1);
    if (clamped !== index) playUiSound('move');
    index = clamped;
    apply();
  }
  function activate() {
    if (items.length) { playUiSound('confirm'); items[index].activate(); }
  }
  function handleKey(e) {
    switch (e.key) {
      case 'ArrowRight': moveTo(index + 1); e.preventDefault(); break;
      case 'ArrowLeft': if (index % cols !== 0) { moveTo(index - 1); e.preventDefault(); } break;
      case 'ArrowDown': moveTo(Math.min(items.length - 1, index + cols)); e.preventDefault(); break;
      case 'ArrowUp': moveTo(Math.max(0, index - cols)); e.preventDefault(); break;
      case 'Enter':
      case ' ': activate(); e.preventDefault(); break;
      case 'Escape': if (onEscape) { playUiSound('back'); onEscape(); e.preventDefault(); } break;
      default: break;
    }
  }
  return { handleKey, activate, getIndex: () => index };
}

// For screens mixing single-item rows (a form row, a list row) with
// horizontal button groups (24-hour/12-hour, Off/On, Small/Medium/Large) —
// unlike create2DNav's uniform grid, each row here can hold a different
// number of items. Up/Down moves between rows (clamping the column to
// whatever the new row has); Left/Right moves within the current row.
// An item with an `adjust(delta)` function (a slider — see
// buildSliderRow) takes Left/Right for itself instead, so a volume bar
// moves directly the way a console settings slider does.
function createRowNav(rows, { onEscape } = {}) {
  rows = rows.filter((r) => r.length);
  const memoryKey = navMemoryKey();
  const saved = (memoryKey && navMemory[memoryKey]) || { row: 0, col: 0 };
  let row = clamp(saved.row, 0, Math.max(0, rows.length - 1));
  let col = clamp(saved.col, 0, Math.max(0, (rows[row] || []).length - 1));
  function currentItem() {
    return (rows[row] || [])[col];
  }
  function apply() {
    rows.forEach((r, ri) => r.forEach((it, ci) => it.el.classList.toggle('kbd-focus', ri === row && ci === col)));
    const cur = currentItem();
    if (!cur) return;
    revealFocused(cur.el);
    if (memoryKey) navMemory[memoryKey] = { row, col };
  }
  rows.forEach((r, ri) => r.forEach((it, ci) => bindPointerFocus(it.el, () => {
    if (ri === row && ci === col) return;
    row = ri;
    col = ci;
    apply();
  })));
  if (rows.length) apply();
  function moveRow(delta) {
    if (!rows.length) return;
    const newRow = clamp(row + delta, 0, rows.length - 1);
    if (newRow !== row) playUiSound('move');
    row = newRow;
    col = Math.min(col, rows[row].length - 1);
    apply();
  }
  function moveCol(delta) {
    const cur = currentItem();
    if (cur?.adjust) { playUiSound('move'); cur.adjust(delta); return; }
    const r = rows[row] || [];
    if (r.length < 2) return;
    const newCol = clamp(col + delta, 0, r.length - 1);
    if (newCol !== col) playUiSound('move');
    col = newCol;
    apply();
  }
  function activate() {
    const item = currentItem();
    if (item?.activate) { playUiSound('confirm'); item.activate(); }
  }
  function handleKey(e) {
    switch (e.key) {
      case 'ArrowDown': moveRow(1); e.preventDefault(); break;
      case 'ArrowUp': moveRow(-1); e.preventDefault(); break;
      case 'ArrowRight': moveCol(1); e.preventDefault(); break;
      case 'ArrowLeft': moveCol(-1); e.preventDefault(); break;
      case 'Enter':
      case ' ': activate(); e.preventDefault(); break;
      case 'Escape': if (onEscape) { playUiSound('back'); onEscape(); e.preventDefault(); } break;
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

/* ---------- footer button hints ---------- */

// With a controller plugged in, Enter/Esc hints show as the pad's own A/B
// face buttons instead of keyboard key names — the same action, labelled
// in terms of whatever is actually in the player's hands.
const PAD_GLYPHS = { Enter: 'A', Esc: 'B' };
let currentHints = [];

function setHints(items) {
  currentHints = items;
  drawHints();
}

function drawHints() {
  const footer = document.getElementById('footer-hints');
  const usePad = gamepadConnected();
  footer.innerHTML = '';
  currentHints.forEach(({ key, label }) => {
    const hint = el('span', 'hint');
    const glyph = usePad && PAD_GLYPHS[key];
    const k = el('span', glyph ? `hint-key pad pad-${glyph.toLowerCase()}` : 'hint-key', glyph || key);
    hint.append(k, el('span', null, label));
    footer.appendChild(hint);
  });
}

window.addEventListener('gamepadconnected', drawHints);
window.addEventListener('gamepaddisconnected', drawHints);

const HINTS = {
  list: [{ key: '↑↓', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }],
  form: [{ key: '↑↓', label: 'Navigate' }, { key: '←→', label: 'Adjust' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }],
  strip: [{ key: '←→', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }],
  grid: [{ key: '↑↓←→', label: 'Navigate' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Back' }],
  choose: [{ key: '←→', label: 'Choose' }, { key: 'Enter', label: 'Select' }, { key: 'Esc', label: 'Cancel' }],
};

/* ---------- modals ---------- */

// `hints` replaces the footer bar's content for as long as this modal is
// open (restored on close) — the underlying screen's hints describe its
// own list, not the dialog now covering it.
function openModal(build, { wide = false, hints } = {}) {
  return new Promise((resolve) => {
    modalOpen = true;
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const backdrop = el('div', 'modal-backdrop');
    const modal = el('div', wide ? 'modal wide' : 'modal');
    backdrop.appendChild(modal);

    const previousHints = currentHints;
    if (hints) setHints(hints);

    function close(value) {
      modalOpen = false;
      root.innerHTML = '';
      setHints(previousHints);
      resolve(value);
    }

    backdrop.addEventListener('keydown', (e) => e.stopPropagation());
    build(modal, close);
    root.appendChild(backdrop);
    // Navs inside build() highlight their first item before the modal is
    // attached, when focus() can't take — focus it now that it can, so key
    // events (real, and the gamepad's synthetic ones, which dispatch from
    // document.activeElement) land inside the dialog instead of on <body>.
    modal.querySelector('.kbd-focus')?.focus();
  });
}

function modalButton(label, primary, onClick) {
  const btn = el('button', primary ? 'btn primary' : 'btn secondary', label);
  btn.onclick = onClick;
  return btn;
}

// Shared shape of every button-row dialog (confirm, error, choice): a
// title, a message, and a Left/Right-navigable row of buttons with a
// visible focus ring on each — Escape always means the `escapeValue`.
function openButtonDialog(title, message, options, { escapeValue = null, initialIndex = 0, preWrap = false } = {}) {
  const hints = options.length > 1 ? HINTS.choose : [{ key: 'Enter', label: 'OK' }];
  return openModal((modal, close) => {
    const p = el('p', null, message);
    if (preWrap) p.style.whiteSpace = 'pre-wrap';
    const buttons = el('div', 'modal-buttons');
    const items = options.map((opt) => {
      const btn = modalButton(opt.label, opt.primary, () => close(opt.value));
      buttons.appendChild(btn);
      return { el: btn, activate: () => close(opt.value) };
    });
    modal.append(el('h3', null, title), p, buttons);
    const nav = createNav(items, { onEscape: () => close(escapeValue), initialIndex });
    modal.parentElement.addEventListener('keydown', (e) => nav.handleKey(e));
  }, { hints });
}

function showConfirm(title, message, confirmLabel = 'Confirm') {
  return openButtonDialog(title, message, [
    { label: 'Cancel', value: false },
    { label: confirmLabel, value: true, primary: true },
  ], { escapeValue: false, initialIndex: 1 });
}

function showError(title, message) {
  return openButtonDialog(title, message, [{ label: 'OK', value: undefined, primary: true }], { escapeValue: undefined, preWrap: true });
}

// options: [{label, value, primary}]
function showChoice(title, message, options) {
  return openButtonDialog(title, message, options);
}

function showPrompt(title, label, initialValue) {
  return openModal((modal, close) => {
    const input = el('input');
    input.type = 'text';
    input.value = initialValue || '';
    const submit = () => close(input.value.trim() || null);
    const buttons = el('div', 'modal-buttons');
    buttons.append(modalButton('Cancel', false, () => close(null)), modalButton('OK', true, submit));
    modal.append(el('h3', null, title), el('label', null, label), input, buttons);

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter') submit();
    });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }, { hints: [{ key: 'Enter', label: 'OK' }, { key: 'Esc', label: 'Cancel' }] });
}

// Non-interactive modal for a brief async wait (SteamGridDB search/fetch) —
// unlike openModal, this returns a close() function immediately rather than
// a promise, since nothing here waits on the user.
function showLoadingModal(text) {
  modalOpen = true;
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const backdrop = el('div', 'modal-backdrop');
  const modal = el('div', 'modal loading');
  modal.append(el('span', 'spinner'), el('p', null, text));
  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  return () => {
    modalOpen = false;
    root.innerHTML = '';
  };
}

// Animated SteamGridDB art has a short video clip as its thumbnail, which
// an <img> can't display — it rendered as a blank tile.
function isVideoThumb(url) {
  return /\.(webm|mp4)(\?|$)/i.test(url || '');
}

function artThumbMedia(g) {
  if (isVideoThumb(g.thumb)) {
    const video = el('video');
    Object.assign(video, { src: g.thumb, muted: true, loop: true, autoplay: true, playsInline: true });
    return video;
  }
  const img = el('img');
  img.loading = 'lazy';
  img.alt = '';
  img.src = g.thumb;
  return img;
}

// gallery: { grids, hasMore, loadMore() } from pickSteamGridDbArt. Every
// option is shown whole (contain, not cover) in a cell shaped for its kind —
// square icons, tall grids, wide banners — with its real size underneath,
// since SteamGridDB "grids" come in several shapes and cropping them all to
// one box hid what you were actually picking. "Load more" fetches the next
// page and appends it in place.
function showArtPicker(gameName, gallery, kind = 'banner') {
  return openModal((modal, close) => {
    modal.classList.add('art-picker');
    const summary = el('p');
    const grid = el('div', `art-grid art-grid-${kind}`);
    const skipBtn = modalButton('Skip', false, () => close(null));
    const buttons = el('div', 'modal-buttons');
    buttons.appendChild(skipBtn);
    modal.append(el('h3', null, `${ART_KIND_LABEL[kind]} for "${gameName}"`), summary, grid, buttons);

    const options = [];
    const seenIds = new Set();
    let moreTile = null;
    let nav = null;
    let loading = false;

    function addOptions(grids) {
      let added = 0;
      for (const g of grids) {
        if (seenIds.has(g.id)) continue;
        seenIds.add(g.id);
        added++;
        const tile = el('div', 'art-option');
        tile.tabIndex = -1; // focusable, so key events keep reaching the dialog
        const media = el('div', 'art-option-media');
        media.appendChild(artThumbMedia(g));
        const meta = el('div', 'art-option-meta');
        meta.appendChild(el('span', null, g.width && g.height ? `${g.width}×${g.height}` : ''));
        if (isVideoThumb(g.thumb) || g.mime === 'image/gif') media.appendChild(el('span', 'art-option-badge', 'Animated'));
        tile.append(media, meta);
        tile.addEventListener('click', () => close(g.url));
        grid.insertBefore(tile, moreTile);
        options.push({ el: tile, activate: () => close(g.url) });
      }
      return added;
    }

    function refreshSummary() {
      const n = options.length;
      summary.textContent = `${n} option${n === 1 ? '' : 's'}${gallery.hasMore ? ', more available' : ''} — pick one, or skip.`;
    }

    function syncMoreTile() {
      if (gallery.hasMore && !moreTile) {
        moreTile = el('div', 'art-option art-more');
        moreTile.tabIndex = -1;
        moreTile.append(iconNode('plus', 'art-more-icon'), el('div', 'art-more-label', 'Load more'));
        moreTile.addEventListener('click', loadMore);
        grid.appendChild(moreTile);
      } else if (!gallery.hasMore && moreTile) {
        moreTile.remove();
        moreTile = null;
      }
    }

    // Columns are measured from the real layout (auto-fill wraps to the
    // dialog's width), so this runs only once the dialog is on screen.
    function buildNav(startIndex) {
      const items = options.slice();
      if (moreTile) items.push({ el: moreTile, activate: loadMore });
      items.push({ el: skipBtn, activate: () => close(null) });
      nav = create2DNav(items, countGridColumns(items), { onEscape: () => close(null), initialIndex: startIndex });
    }

    async function loadMore() {
      if (loading || !moreTile) return;
      loading = true;
      moreTile.classList.add('loading');
      moreTile.lastChild.textContent = 'Loading…';
      const firstNew = options.length;
      const res = await gallery.loadMore();
      loading = false;
      const added = res.ok ? addOptions(res.grids) : 0;
      // A page with nothing new (or a failed request) ends the list rather
      // than leaving a "Load more" that never loads anything.
      gallery.hasMore = res.ok && res.hasMore && added > 0;
      if (moreTile) {
        moreTile.classList.remove('loading');
        moreTile.lastChild.textContent = 'Load more';
      }
      syncMoreTile();
      refreshSummary();
      buildNav(added ? firstNew : options.length);
    }

    addOptions(gallery.grids);
    syncMoreTile();
    refreshSummary();
    modal.parentElement.addEventListener('keydown', (e) => { if (nav) nav.handleKey(e); });
    requestAnimationFrame(() => buildNav(0));
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
const ART_FETCHERS = {
  icon: (id, page) => window.api.steamGridDbIcons(id, page),
  grid: (id, page) => window.api.steamGridDbGrids(id, page),
  banner: (id, page) => window.api.steamGridDbHeroes(id, page),
};

// Runs one async step behind a loading modal, always closing it after.
async function withLoading(text, fn) {
  const hide = showLoadingModal(text);
  try {
    return await fn();
  } finally {
    hide();
  }
}

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
    const searchRes = await withLoading(`Searching SteamGridDB for "${name}"…`, () => window.api.steamGridDbSearch(name));
    if (!searchRes.ok || !searchRes.results.length) return null;
    match = searchRes.results[0];
    sgdbSearchCache.set(searchKey, match);
  }

  // A gallery accumulates every page loaded so far, so reopening the picker
  // for the same game+kind shows everything already fetched, "Load more"
  // included, without refetching.
  const artCacheKey = `${match.id}:${kind}`;
  let gallery = sgdbArtCache.get(artCacheKey);
  if (!gallery) {
    const firstPage = await withLoading(`Fetching ${ART_KIND_LABEL[kind].toLowerCase()} options…`, () => ART_FETCHERS[kind](match.id, 0));
    if (!firstPage.ok || !firstPage.grids.length) return null;
    gallery = { grids: firstPage.grids, page: 0, hasMore: !!firstPage.hasMore };
    gallery.loadMore = async () => {
      const res = await ART_FETCHERS[kind](match.id, gallery.page + 1);
      if (res.ok) {
        gallery.page += 1;
        gallery.grids = gallery.grids.concat(res.grids);
      }
      return res;
    };
    sgdbArtCache.set(artCacheKey, gallery);
  }

  const chosenUrl = await showArtPicker(match.name, gallery, kind);
  if (!chosenUrl) return null;

  const dl = await withLoading('Downloading…', () => window.api.steamGridDbDownload({ url: chosenUrl, appPath, kind }));
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

/* ---------- tiles (home row, Settings grid, Remove/Update pickers, Menu Color) ---------- */

const KIND_ICONS = {
  add: 'plus', remove: 'trash', updateGame: 'edit', color: 'droplet', updateUser: 'user',
  font: 'type', time: 'clock', music: 'music', uiSounds: 'volume', steamgriddb: 'image',
  back: 'back', settings: 'gear', quit: 'power', custom: 'sliders',
};

function letterNode(name) {
  return el('span', 'letter', (name[0] || '?').toUpperCase());
}

function tileArt(entry) {
  if (entry.kind === 'game') {
    if (!entry.iconPath) return letterNode(entry.name);
    const img = el('img', 'icon-img');
    img.src = fileUrl(entry.iconPath);
    img.alt = entry.name;
    return img;
  }
  return iconNode(KIND_ICONS[entry.kind] || 'image', 'tile-icon');
}

// A card: square art on top, name (and, when given, a small action word
// shown only while focused) underneath. `active` pins a check badge in the
// corner — used by Menu Color for the current swatch/mode.
function buildTile(entry, { action, art = tileArt(entry), caption = true, active = false, extraClass = '' } = {}) {
  const tile = el('div', `tile ${extraClass}`.trim());
  tile.title = entry.name;
  const artBox = el('div', 'tile-art');
  artBox.appendChild(art);
  if (active) artBox.appendChild(iconNode('check', 'tile-badge'));
  tile.appendChild(artBox);
  if (caption) {
    tile.appendChild(el('div', 'tile-label', entry.name));
    if (action) tile.appendChild(el('div', 'tile-action', action));
  }
  return tile;
}

// layout: 'strip' (one horizontally-scrolling row) or 'grid' (wrapping).
function buildTileCollection(entries, onActivate, { layout = 'grid', tileOptions = () => ({}) } = {}) {
  const outer = el('div', layout === 'strip' ? 'tile-strip-outer' : 'tile-grid-outer');
  const inner = el('div', layout === 'strip' ? 'tile-strip' : 'tile-grid');
  const items = entries.map((entry) => {
    const tile = buildTile(entry, tileOptions(entry));
    tile.addEventListener('click', () => onActivate(entry));
    inner.appendChild(tile);
    return { el: tile, activate: () => onActivate(entry) };
  });
  outer.appendChild(inner);
  return { el: outer, items };
}

/* ---------- shared screen building blocks ---------- */

// Every sub-screen is the same frame: the persistent header, then a title
// (+ optional subtitle), then a scrolling content column. Returns the
// content column for the caller to fill.
function buildScreen(appEl, title, subtitle) {
  const screen = el('div', 'screen');
  const head = el('div', 'screen-head');
  head.appendChild(el('div', 'screen-title', title));
  if (subtitle) head.appendChild(el('div', 'screen-subtitle', subtitle));
  const content = el('div', 'screen-content');
  screen.append(head, content);
  appEl.append(buildHeader(), screen);
  return content;
}

function buildSectionLabel(text) {
  return el('div', 'section-label', text);
}

function buildEmptyNote(text) {
  return el('div', 'empty-note', text);
}

function buildBackButton(onBack) {
  const btn = el('div', 'btn secondary back-btn');
  btn.append(iconNode('back'), el('span', null, 'Back'));
  btn.addEventListener('click', onBack);
  return { el: btn, activate: onBack };
}

// A single focusable row: a label on the left, optionally the current
// value on the right. Returned as {el, activate} — the item shape every nav
// constructor takes.
function buildRow(label, { value, onActivate, iconName } = {}) {
  const row = el('div', 'row');
  if (iconName) row.appendChild(iconNode(iconName, 'row-icon'));
  row.appendChild(el('div', 'row-label', label));
  if (value !== undefined) row.appendChild(el('div', 'row-value', value));
  if (onActivate) row.addEventListener('click', onActivate);
  return { el: row, activate: onActivate };
}

// A connected segmented control (24-hour/12-hour, Off/On, Small/Medium/
// Large). options: [{label, active, onActivate}] -> {el, items}.
function buildOptionGroup(options) {
  const group = el('div', 'option-group');
  const items = options.map(({ label, active, onActivate }) => {
    const btn = el('div', active ? 'option-btn active' : 'option-btn', label);
    btn.addEventListener('click', onActivate);
    group.appendChild(btn);
    return { el: btn, activate: onActivate };
  });
  return { el: group, items };
}

// A console-style slider row: Left/Right (or the −/+ ends, for the mouse)
// nudge it directly — see createRowNav's `adjust` handling. `fraction` is
// the fill, 0..1.
function buildSliderRow(label, { fraction, valueText, onAdjust }) {
  const row = el('div', 'row slider-row');
  const track = el('div', 'slider');
  const fill = el('div', 'slider-fill');
  fill.style.width = `${clamp(fraction, 0, 1) * 100}%`;
  track.appendChild(fill);
  const minus = el('div', 'slider-step', '−');
  const plus = el('div', 'slider-step', '+');
  minus.addEventListener('click', () => onAdjust(-1));
  plus.addEventListener('click', () => onAdjust(1));
  row.append(el('div', 'row-label', label), minus, track, plus, el('div', 'row-value', valueText));
  return { el: row, adjust: onAdjust };
}

// Shared by every "pick from a list of imported files" screen (Change
// Font, Background Music's track list, Menu Sounds) — each row shows a
// label, an Active/Select status, and an optional Remove button.
function buildSelectableRow({ label, isActive, onActivate, onRemove }) {
  const row = el('div', 'list-row' + (isActive ? ' active' : ''));
  row.append(el('div', 'list-row-name', label), el('div', 'list-row-meta', isActive ? 'Active' : 'Select'));
  if (onRemove) {
    const removeBtn = el('div', 'list-row-remove', 'Remove');
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
    row.append(removeBtn);
  }
  row.addEventListener('click', onActivate);
  return { el: row, activate: onActivate };
}

function buildList(rows, { emptyText, scroll = false } = {}) {
  const list = el('div', scroll ? 'list scroll' : 'list');
  rows.forEach((r) => list.appendChild(r.el));
  if (!rows.length && emptyText) list.appendChild(buildEmptyNote(emptyText));
  return list;
}

/* ---------- header ---------- */

async function confirmQuit() {
  if (await showConfirm('Quit', 'Quit the launcher?', 'Quit')) window.api.quit();
}

// Persistent header used by every screen: player icon+name (click to open
// Update Player), clock, a settings-gear shortcut, and power.
//
// The Settings/Power icons are a mouse convenience layered on top of, not
// instead of, the home row's own Settings/Quit tiles (see renderMenu) —
// those stay the authoritative controller/keyboard-reachable path, so
// these mouse-clickable header icons don't reintroduce a mouse-only dead end.
function buildHeader() {
  const header = el('div', 'header');

  const player = el('div', 'header-player');
  const avatar = el('div', 'avatar');
  if (state.user.iconPath) {
    const img = el('img');
    img.src = fileUrl(state.user.iconPath);
    img.alt = state.user.name;
    avatar.appendChild(img);
  } else {
    avatar.textContent = (state.user.name[0] || 'P').toUpperCase();
  }
  player.append(avatar, el('div', 'header-player-name', state.user.name));
  player.addEventListener('click', () => goTo('updateUser'));

  const right = el('div', 'header-right');
  const clock = el('div', 'clock', formatClock());
  clockInterval = setInterval(() => { clock.textContent = formatClock(); }, 1000);

  const settingsBtn = el('div', 'header-icon-btn');
  settingsBtn.title = 'Settings';
  settingsBtn.appendChild(iconNode('gear'));
  settingsBtn.addEventListener('click', () => goTo('settings'));

  const powerBtn = el('div', 'header-icon-btn power');
  powerBtn.title = 'Quit';
  powerBtn.appendChild(iconNode('power'));
  powerBtn.addEventListener('click', confirmQuit);

  right.append(clock, settingsBtn, powerBtn);
  header.append(player, right);
  return header;
}

/* ---------- central render ---------- */

const SCREENS = {
  menu: renderMenu,
  settings: renderSettings,
  remove: renderRemove,
  color: renderColor,
  updateGamePick: renderUpdateGamePick,
  updateGameEdit: renderUpdateGameEdit,
  updateUser: renderUpdateUser,
  font: renderFont,
  time: renderTime,
  music: renderMusic,
  uiSounds: renderUiSounds,
};

let lastRenderedScreen = null;

function render() {
  clearInterval(clockInterval);
  clearInterval(screenInterval);
  screenInterval = null;
  currentKeyHandler = null;
  backdropWanted = null;
  const appEl = document.getElementById('app');
  // The entrance animation only plays when actually arriving on a screen —
  // a same-screen re-render (after changing a setting, or a resize) swaps
  // content in place instead of visibly re-entering.
  appEl.classList.toggle('screen-enter', ui.screen !== lastRenderedScreen);
  lastRenderedScreen = ui.screen;
  appEl.innerHTML = '';
  (SCREENS[ui.screen] || renderMenu)(appEl);
  applyBackdrop();
}

/* ---------- home: game row + hero ---------- */

function settingsEntries() {
  return [
    { kind: 'add', name: 'Add Game' },
    { kind: 'remove', name: 'Remove Game' },
    { kind: 'updateGame', name: 'Update Game' },
    { kind: 'color', name: 'Menu Color' },
    { kind: 'updateUser', name: 'Update User' },
    { kind: 'font', name: 'Change Font' },
    { kind: 'time', name: 'Time Setting' },
    { kind: 'music', name: 'Background Music' },
    { kind: 'uiSounds', name: 'Menu Sounds' },
    { kind: 'steamgriddb', name: 'Cover Art Key' },
    { kind: 'back', name: 'Back' },
  ];
}

const SETTINGS_SCREEN_FOR = {
  remove: 'remove', updateGame: 'updateGamePick', color: 'color', updateUser: 'updateUser',
  font: 'font', time: 'time', music: 'music', uiSounds: 'uiSounds', back: 'menu',
};

async function activateSettingsEntry(entry) {
  if (entry.kind === 'add') await addGameFlow();
  else if (entry.kind === 'steamgriddb') await manageSteamGridDbKey();
  else if (SETTINGS_SCREEN_FOR[entry.kind]) goTo(SETTINGS_SCREEN_FOR[entry.kind]);
}

async function launchGame(entry) {
  pauseBackgroundMusic();
  let result;
  try {
    result = await window.api.launchApp(entry.path);
  } catch (e) {
    // The IPC call itself failed rather than resolving with {ok:false} —
    // no process was ever spawned, so (same as the !result.ok case below)
    // there's no 'game-exited' event coming later to resume music.
    playBackgroundMusic();
    await showError('Launch failed', e?.message || String(e));
    return;
  }
  if (!result.ok) {
    // The app never actually started, so there's no 'game-exited' event
    // coming later to resume it — do that here instead.
    playBackgroundMusic();
    await showError('Launch failed', result.error);
  }
}

async function addGameFlow() {
  const chosen = await window.api.chooseAppPath();
  if (!chosen) return;
  const defaultName = baseName(chosen.replace(/[\\/]+$/, '')).replace(/\.[^.]+$/, '');
  const name = await showPrompt('New app', 'Name:', defaultName);
  if (!name) return;
  const iconPath = await pickImageFor('icon', name, chosen);
  const gridPath = await pickImageFor('grid', name, chosen);
  const bannerPath = await pickImageFor('banner', name, chosen);
  state.apps = await window.api.addApp({ name, path: chosen, iconPath, gridPath, bannerPath });
  render();
}

// Home screen, laid out like a console dashboard: a horizontal row of game
// tiles along the top (Settings and Quit at its end, so they're reachable
// with the same Left/Right as everything else), and underneath, a hero for
// whichever tile is focused — title, playtime, a Play button, its cover
// art — over that game's banner filling the screen as a backdrop.
//
// Two nav zones: the row, and the hero's Play button. Down/Enter on a game
// moves focus onto Play; Up/Escape returns to the row. Focusing a game only
// previews it — launching always goes through Play, so the tile itself is
// never a launch shortcut. Enter on Settings/Quit acts immediately.
function renderMenu(appEl) {
  const entries = state.apps.map((a) => ({ kind: 'game', ...a }))
    .concat([{ kind: 'settings', name: 'Settings' }, { kind: 'quit', name: 'Quit' }]);

  const home = el('div', 'home');
  const rowOuter = el('div', 'game-row-outer');
  const row = el('div', 'game-row');
  rowOuter.appendChild(row);
  const hero = el('div', 'hero');
  home.append(rowOuter, hero);
  appEl.append(buildHeader(), home);

  let zone = 'row';
  let playBtn = null;

  const items = entries.map((entry, i) => {
    const tile = buildTile(entry, { caption: false, extraClass: entry.kind === 'game' ? 'game-tile' : 'game-tile system' });
    // Mouse: clicking a game just focuses it (pointer-over already does);
    // Settings/Quit act straight away.
    tile.addEventListener('click', () => { if (entry.kind !== 'game') activateEntry(entry); });
    // createNav ignores pointing at the tile it already has focused, so
    // coming back from Play onto that same tile needs its own zone reset.
    tile.addEventListener('mousemove', () => { if (pointerReallyMoved && zone === 'play') focusRow(i); });
    row.appendChild(tile);
    return { el: tile, activate: () => activateEntry(entries[i]) };
  });

  function activateEntry(entry) {
    if (entry.kind === 'settings') goTo('settings');
    else if (entry.kind === 'quit') confirmQuit();
  }

  function fillHero(entry) {
    hero.innerHTML = '';
    playBtn = null;
    const info = el('div', 'hero-info');
    const title = el('div', 'hero-title', entry.name);
    const meta = el('div', 'hero-meta');
    info.append(title, meta);

    if (entry.kind !== 'game') {
      meta.textContent = entry.kind === 'settings'
        ? (state.apps.length ? 'Games, appearance, sound and your profile.' : 'No games yet — add one from Settings.')
        : 'Close Virtual Launcher.';
      hero.appendChild(info);
      showBackdrop(null);
      return;
    }

    meta.textContent = formatPlaytime(entry.playtimeSeconds);
    const actions = el('div', 'hero-actions');
    playBtn = el('div', 'btn primary play-btn');
    playBtn.append(iconNode('play'), el('span', null, 'Play'));
    playBtn.addEventListener('click', () => launchGame(entry));
    bindPointerFocus(playBtn, focusPlay);
    actions.appendChild(playBtn);
    info.appendChild(actions);

    const cover = el('div', 'hero-cover');
    if (entry.gridPath) {
      const img = el('img');
      img.src = fileUrl(entry.gridPath);
      img.alt = entry.name;
      cover.appendChild(img);
    } else {
      cover.classList.add('empty');
      cover.appendChild(tileArt(entry));
    }
    hero.append(info, cover);
    // Restart the hero's fade-in so switching games reads as a transition,
    // not an instant text swap.
    hero.classList.remove('hero-swap');
    void hero.offsetWidth;
    hero.classList.add('hero-swap');
    showBackdrop(entry.bannerPath);
  }

  function hintsFor(entry) {
    if (entry?.kind === 'game') return [{ key: '←→', label: 'Browse' }, { key: 'Enter', label: 'Select' }];
    return [{ key: '←→', label: 'Browse' }, { key: 'Enter', label: 'Open' }];
  }

  function focusPlay() {
    if (!playBtn || zone === 'play') return;
    zone = 'play';
    home.classList.add('zone-play');
    playBtn.classList.add('kbd-focus');
    setHints([{ key: '↑', label: 'Back' }, { key: 'Enter', label: 'Play' }]);
  }

  function focusRow(index) {
    zone = 'row';
    home.classList.remove('zone-play');
    if (playBtn) playBtn.classList.remove('kbd-focus');
    setHints(hintsFor(entries[index]));
  }

  // Takes the index from onFocus rather than reading nav.getIndex() —
  // createNav invokes onFocus synchronously during its own construction,
  // before `const nav` below has been assigned.
  const nav = createNav(items, {
    onFocus: (_item, i) => {
      fillHero(entries[i]);
      focusRow(i);
    },
  });

  // This screen runs its own row/play zone state machine on top of
  // createNav, so the sounds for the zone switches are called out here
  // rather than coming for free from the nav constructor.
  currentKeyHandler = (e) => {
    const focused = entries[nav.getIndex()];
    if (zone === 'play') {
      if (e.key === 'ArrowUp' || e.key === 'Escape') { playUiSound('back'); focusRow(nav.getIndex()); e.preventDefault(); return; }
      if (e.key === 'Enter' || e.key === ' ') { playUiSound('confirm'); launchGame(focused); e.preventDefault(); }
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && focused?.kind === 'game') {
      playUiSound('move');
      focusPlay();
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); return; }
    nav.handleKey(e);
  };
}

/* ---------- settings grid ---------- */

function renderSettings(appEl) {
  const content = buildScreen(appEl, 'Settings');
  const goBack = () => goTo('menu');
  const { el: gridEl, items } = buildTileCollection(settingsEntries(), activateSettingsEntry, {
    tileOptions: (entry) => ({ action: entry.kind === 'back' ? 'Back' : 'Open' }),
  });
  content.appendChild(gridEl);

  const nav = create2DNav(items, countGridColumns(items), { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);
  setHints(HINTS.grid);
}

/* ---------- update user ---------- */

// Name and Icon as separate rows — each shows its current value, and
// selecting one edits just that field.
function renderUpdateUser(appEl) {
  const content = buildScreen(appEl, 'Update Player', 'Choose what to change — everything else stays the same.');
  const goBack = () => goTo('settings');

  const nameRow = buildRow('Name', {
    value: state.user.name,
    onActivate: async () => {
      const name = await showPrompt('Change Name', 'Player name:', state.user.name);
      if (!name) return;
      state.user = await window.api.updateUser({ name });
      render();
    },
  });
  const iconRow = buildRow('Icon', {
    value: state.user.iconPath ? 'Set' : 'None',
    onActivate: async () => {
      const picked = await window.api.chooseImagePath();
      if (!picked) return;
      state.user = await window.api.updateUser({ iconPath: picked });
      render();
    },
  });
  const back = buildBackButton(goBack);
  content.append(buildList([nameRow, iconRow]), back.el);

  const nav = createNav([nameRow, iconRow, back], { vertical: true, onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);
  setHints(HINTS.list);
}

/* ---------- remove game / update game picker ---------- */

function renderGamePicker(appEl, title, actionWord, onPick) {
  const content = buildScreen(appEl, title);
  const goBack = () => goTo('settings');
  const entries = state.apps.map((a) => ({ kind: 'game', ...a })).concat([{ kind: 'back', name: 'Back' }]);
  const { el: stripEl, items } = buildTileCollection(entries, (entry) => {
    if (entry.kind === 'back') goBack();
    else onPick(entry);
  }, {
    layout: 'strip',
    tileOptions: (entry) => ({ action: entry.kind === 'back' ? 'Back' : actionWord }),
  });
  content.appendChild(stripEl);
  if (!state.apps.length) content.appendChild(buildEmptyNote('No games added yet.'));

  const nav = createNav(items, { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);
  setHints(HINTS.strip);
}

function renderRemove(appEl) {
  renderGamePicker(appEl, 'Remove Game', 'Remove', async (entry) => {
    const ok = await showConfirm('Remove game', `Remove "${entry.name}" from the launcher?`, 'Remove');
    if (!ok) return;
    state.apps = await window.api.removeApp(entry.slug);
    render();
  });
}

function renderUpdateGamePick(appEl) {
  renderGamePicker(appEl, 'Update Game', 'Edit', (entry) => {
    ui.updateGameSlug = entry.slug;
    goTo('updateGameEdit');
  });
}

/* ---------- update game: edit ---------- */

const ART_FIELDS = [
  { kind: 'icon', label: 'Icon', key: 'iconPath' },
  { kind: 'grid', label: 'Grid', key: 'gridPath' },
  { kind: 'banner', label: 'Banner', key: 'bannerPath' },
];

function renderUpdateGameEdit(appEl) {
  const entry = findAppBySlug(ui.updateGameSlug);
  if (!entry) { goTo('settings'); return; }

  const content = buildScreen(appEl, entry.name, 'Update this game’s name and artwork.');
  showBackdrop(entry.bannerPath);
  const goBack = () => goTo('updateGamePick');

  const nameRow = buildRow('Name', {
    value: entry.name,
    onActivate: async () => {
      const name = await showPrompt('Name', 'Game name:', entry.name);
      if (!name) return;
      state.apps = await window.api.updateApp({ slug: entry.slug, name });
      render();
    },
  });
  const artRows = ART_FIELDS.map(({ kind, label, key }) => buildRow(label, {
    value: entry[key] ? 'Set' : 'None',
    onActivate: async () => {
      const result = await pickImageFor(kind, entry.name, entry.path);
      if (result === undefined) return;
      state.apps = await window.api.updateApp({ slug: entry.slug, [key]: result });
      render();
    },
  }));
  const back = buildBackButton(goBack);
  content.append(buildList([nameRow, ...artRows]), back.el);

  const nav = createNav([nameRow, ...artRows, back], { vertical: true, onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);
  setHints(HINTS.list);
}

/* ---------- font settings ---------- */

const FONT_SCALE_MIN = 0.7;
const FONT_SCALE_MAX = 2;

function renderFont(appEl) {
  const content = buildScreen(appEl, 'Change Font');
  const goBack = () => goTo('settings');

  const importRow = buildRow('Import Font File…', {
    iconName: 'plus',
    onActivate: async () => {
      const picked = await window.api.chooseFontPath();
      if (!picked) return;
      applyCustomFont(picked.path, 'CustomUserFont');
      applyCustomFontScale(1); // a freshly imported font always starts at its own 100%
      state.fontPath = picked.path;
      state.fontFamily = 'CustomUserFont';
      state.customFonts = picked.customFonts;
      render();
    },
  });
  const resetRow = buildRow('Reset to Default Font', {
    iconName: 'back',
    onActivate: async () => {
      applyCustomFont(null, null);
      applyCustomFontScale(1);
      state.fontPath = null;
      state.fontFamily = null;
      await persistDisplaySettings();
      render();
    },
  });

  // Every font ever imported stays listed here (stored in the app's own
  // data dir — see main.js's choose-font-path), so switching back to one
  // used before is a click on its row, not another trip through the file
  // browser to find that file again.
  const activeFontFileName = baseName(state.fontPath);
  const applyFontData = (data) => {
    state.fontPath = data.fontPath;
    state.fontFamily = data.fontFamily;
    state.customFonts = data.customFonts;
    render();
  };
  const fontRows = state.customFonts.map((font) => buildSelectableRow({
    label: font.displayName,
    isActive: font.fileName === activeFontFileName,
    onActivate: async () => {
      const data = await window.api.selectFont(font.fileName);
      applyCustomFont(data.fontPath, data.fontFamily);
      applyCustomFontScale(font.scale || 1);
      applyFontData(data);
    },
    onRemove: async () => {
      const data = await window.api.removeFont(font.fileName);
      if (!data.fontPath) { applyCustomFont(null, null); applyCustomFontScale(1); }
      applyFontData(data);
    },
  }));

  // Only shown for an active custom font — the default UI font doesn't
  // need it since every size in this app was tuned against it.
  const activeFontEntry = state.customFonts.find((f) => f.fileName === activeFontFileName);
  let scaleRow = null;
  if (activeFontEntry) {
    const currentScale = activeFontEntry.scale || 1;
    scaleRow = buildSliderRow('Font Scale', {
      fraction: (currentScale - FONT_SCALE_MIN) / (FONT_SCALE_MAX - FONT_SCALE_MIN),
      valueText: `${Math.round(currentScale * 100)}%`,
      onAdjust: async (delta) => {
        const newScale = Math.round(clamp(currentScale + delta * 0.1, FONT_SCALE_MIN, FONT_SCALE_MAX) * 10) / 10;
        if (newScale === currentScale) return;
        const data = await window.api.setFontScale({ fileName: activeFontEntry.fileName, scale: newScale });
        applyCustomFontScale(newScale);
        state.customFonts = data.customFonts;
        render();
      },
    });
  }

  const size = buildOptionGroup(['small', 'medium', 'large'].map((s) => ({
    label: capitalize(s),
    active: state.fontSize === s,
    onActivate: async () => {
      applyFontSize(s);
      state.fontSize = s;
      await persistDisplaySettings();
      render();
    },
  })));

  const back = buildBackButton(goBack);
  content.append(buildList([importRow, resetRow]));
  content.append(buildSectionLabel('Imported Fonts'), buildList(fontRows, { emptyText: 'No fonts imported yet.' }));
  if (scaleRow) content.append(buildList([scaleRow]));
  content.append(buildSectionLabel('Text Size'), size.el, back.el);

  const nav = createRowNav([
    [importRow],
    [resetRow],
    ...fontRows.map((r) => [r]),
    scaleRow ? [scaleRow] : [],
    size.items,
    [back],
  ], { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);
  setHints(HINTS.form);
}

/* ---------- time settings ---------- */

function renderTime(appEl) {
  const content = buildScreen(appEl, 'Time Setting', `Showing ${state.timezone || 'System Default'} — display only, your system clock is untouched.`);
  const goBack = () => goTo('settings');

  const setAndSave = (patch) => async () => {
    Object.assign(state, patch);
    await persistDisplaySettings();
    render();
  };

  const format = buildOptionGroup([
    { label: '24-hour', active: state.timeFormat === '24h', onActivate: setAndSave({ timeFormat: '24h' }) },
    { label: '12-hour', active: state.timeFormat === '12h', onActivate: setAndSave({ timeFormat: '12h' }) },
  ]);
  const seconds = buildOptionGroup([
    { label: 'Off', active: !state.showSeconds, onActivate: setAndSave({ showSeconds: false }) },
    { label: 'On', active: state.showSeconds, onActivate: setAndSave({ showSeconds: true }) },
  ]);

  // Each row shows the option's own live clock plus how far it sits from
  // the zone that's actually applied right now (`state.timezone`), so
  // picking a zone is never a guess at what time it'll show.
  const zoneRows = ['System Default', ...state.timezones].map((tz) => {
    const zoneValue = tz === 'System Default' ? null : tz;
    const isCurrent = zoneValue === state.timezone;
    const row = el('div', 'list-row' + (isCurrent ? ' active' : ''));
    const clock = el('div', 'list-row-clock');
    const diff = el('div', 'list-row-meta');
    row.append(el('div', 'list-row-name', tz), clock, diff);
    const refresh = () => {
      clock.textContent = formatClock(zoneValue);
      diff.textContent = isCurrent ? 'Current' : zoneDiffLabel(zoneValue, state.timezone);
    };
    refresh();
    const activate = setAndSave({ timezone: zoneValue });
    row.addEventListener('click', activate);
    return { el: row, activate, refresh };
  });
  screenInterval = setInterval(() => zoneRows.forEach((r) => r.refresh()), 1000);

  const back = buildBackButton(goBack);
  content.append(
    buildSectionLabel('Clock Format'), format.el,
    buildSectionLabel('Show Seconds'), seconds.el,
    buildSectionLabel('Time Zone'), buildList(zoneRows, { scroll: true }),
    back.el,
  );

  const nav = createRowNav([format.items, seconds.items, ...zoneRows.map((r) => [r]), [back]], { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);
  setHints(HINTS.form);
}

/* ---------- background music ---------- */

function renderMusic(appEl) {
  const content = buildScreen(appEl, 'Background Music', state.musicPath
    ? 'Plays in the menu and pauses while a game is running.'
    : 'No music set — it plays in the menu and pauses while a game is running.');
  const goBack = () => goTo('settings');

  const importRow = buildRow('Import Music File…', {
    iconName: 'plus',
    onActivate: async () => {
      const previousPath = state.musicPath;
      const data = await window.api.chooseMusicPath();
      state.musicPath = data.musicPath;
      state.customMusic = data.customMusic;
      // Cancelling the file picker returns the same musicPath unchanged —
      // skip reapplying it, or the already-playing track would restart
      // from 0 for no reason.
      if (state.musicPath !== previousPath) {
        applyMusicSource(state.musicPath);
        playBackgroundMusic();
      }
      render();
    },
  });

  // Every track ever imported stays listed here (stored in the app's own
  // data dir — see main.js's choose-music-path), so switching back to one
  // used before is a click on its row.
  const activeFileName = baseName(state.musicPath);
  const trackRows = state.customMusic.map((track) => {
    const isActive = track.fileName === activeFileName;
    return buildSelectableRow({
      label: track.displayName,
      isActive,
      onActivate: async () => {
        if (isActive) return; // already playing this one — don't restart it from 0
        const data = await window.api.selectMusic(track.fileName);
        state.musicPath = data.musicPath;
        applyMusicSource(state.musicPath);
        playBackgroundMusic();
        render();
      },
      onRemove: async () => {
        const data = await window.api.removeMusic(track.fileName);
        state.musicPath = data.musicPath;
        state.customMusic = data.customMusic;
        if (isActive) { pauseBackgroundMusic(); applyMusicSource(null); }
        render();
      },
    });
  });

  const volumePct = Math.round(state.musicVolume * 100);
  const volumeRow = buildSliderRow('Volume', {
    fraction: state.musicVolume,
    valueText: state.musicMuted ? 'Muted' : `${volumePct}%`,
    onAdjust: async (delta) => {
      const newVolume = Math.round(clamp(state.musicVolume + delta * 0.05, 0, 1) * 20) / 20;
      if (newVolume === state.musicVolume) return;
      const data = await window.api.setMusicVolume(newVolume);
      state.musicVolume = data.musicVolume;
      applyMusicVolume();
      render();
    },
  });
  if (state.musicMuted) volumeRow.el.classList.add('muted');

  // A dedicated toggle rather than just "turn Volume down to 0%" — muting
  // this way remembers the volume you had, so unmuting doesn't come back
  // silent or force you to re-pick a level.
  const muteRow = buildRow(state.musicMuted ? 'Unmute' : 'Mute', {
    iconName: 'volume',
    value: state.musicMuted ? `Back to ${volumePct}%` : undefined,
    onActivate: async () => {
      const data = await window.api.setMusicMuted(!state.musicMuted);
      state.musicMuted = data.musicMuted;
      applyMusicVolume();
      render();
    },
  });

  const back = buildBackButton(goBack);
  content.append(
    buildList([importRow]),
    buildSectionLabel('Imported Tracks'), buildList(trackRows, { emptyText: 'No music imported yet.' }),
    buildSectionLabel('Playback'), buildList([volumeRow, muteRow]),
    back.el,
  );

  const nav = createRowNav([[importRow], ...trackRows.map((r) => [r]), [volumeRow], [muteRow], [back]], { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);
  setHints(HINTS.form);
}

/* ---------- menu (nav) sounds ---------- */

const UI_SOUND_LABELS = { move: 'Move', confirm: 'Confirm', back: 'Back' };

function renderUiSounds(appEl) {
  const content = buildScreen(appEl, 'Menu Sounds', 'Import your own sound for any category, or pick Default for the built-in tone. Selecting a row plays it.');
  const goBack = () => goTo('settings');
  const rows = [];

  ['move', 'confirm', 'back'].forEach((kind) => {
    const applySoundData = (data) => {
      state.uiSounds = data.uiSounds;
      if (data.customUiSounds) state.customUiSounds = data.customUiSounds;
      resetCustomUiSound(kind);
    };
    const importRow = buildRow('Import Custom Sound…', {
      iconName: 'plus',
      onActivate: async () => {
        applySoundData(await window.api.chooseUiSound(kind));
        previewUiSound(kind);
        render();
      },
    });

    // A synthetic first entry standing in for "no custom file" — folds
    // reverting to the built-in tone into the same select-from-a-list
    // interaction as every real imported sound below it.
    const activeFileName = baseName(state.uiSounds[kind]);
    const defaultRow = buildSelectableRow({
      label: 'Default (Built-in)',
      isActive: !activeFileName,
      onActivate: async () => {
        if (activeFileName) { applySoundData(await window.api.clearUiSound(kind)); render(); }
        previewUiSound(kind);
      },
    });
    const soundRows = state.customUiSounds[kind].map((sound) => {
      const isActive = sound.fileName === activeFileName;
      return buildSelectableRow({
        label: sound.displayName,
        isActive,
        onActivate: async () => {
          if (!isActive) { applySoundData(await window.api.selectUiSound(kind, sound.fileName)); render(); }
          previewUiSound(kind);
        },
        onRemove: async () => {
          applySoundData(await window.api.removeUiSound(kind, sound.fileName));
          render();
        },
      });
    });

    content.append(buildSectionLabel(`${UI_SOUND_LABELS[kind]} Sound`), buildList([importRow, defaultRow, ...soundRows]));
    rows.push([importRow], [defaultRow], ...soundRows.map((r) => [r]));
  });

  const back = buildBackButton(goBack);
  content.appendChild(back.el);
  rows.push([back]);

  const nav = createRowNav(rows, { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);
  setHints(HINTS.list);
}

/* ---------- menu color ---------- */

function colorTileArt(entry) {
  if (entry.kind === 'swatch') {
    const swatch = el('span', 'swatch');
    swatch.style.background = entry.hex;
    return swatch;
  }
  if (entry.kind === 'mode') return iconNode(entry.mode === 'light' ? 'sun' : 'moon', 'tile-icon');
  return tileArt(entry);
}

// R/G/B fine-tuning for a single accent color, for when none of the
// presets are quite right.
function showCustomColorModal(initialHex) {
  return openModal((modal, close) => {
    const preview = el('div', 'color-preview');
    const rowsWrap = el('div', 'color-rows');
    const values = Theme.hexToRgb(initialHex);
    let rowIndex = 0;

    const rowEls = ['Red', 'Green', 'Blue'].map((label, i) => {
      const row = el('div', 'color-row');
      const bar = el('div', 'slider');
      const fill = el('div', `slider-fill channel-${i}`);
      bar.appendChild(fill);
      const value = el('div', 'color-row-value');
      row.append(el('div', 'color-row-label', label), bar, value);
      rowsWrap.appendChild(row);

      row.addEventListener('click', () => { rowIndex = i; refresh(); });
      function setFromEvent(e) {
        const rect = bar.getBoundingClientRect();
        const x = clamp(e.clientX - rect.left, 0, rect.width);
        rowIndex = i;
        values[i] = Math.round((x / rect.width) * 255);
        refresh();
      }
      bar.addEventListener('mousedown', (e) => {
        setFromEvent(e);
        const onUp = () => {
          window.removeEventListener('mousemove', setFromEvent);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', setFromEvent);
        window.addEventListener('mouseup', onUp);
      });
      return { row, fill, value };
    });

    const okBtn = modalButton('Apply', true, () => close(Theme.rgbToHex(values)));
    const buttons = el('div', 'modal-buttons');
    buttons.append(modalButton('Cancel', false, () => close(null)), okBtn);
    modal.append(el('h3', null, 'Custom Accent Color'), preview, rowsWrap, buttons);

    function refresh() {
      preview.style.background = Theme.rgbToHex(values);
      rowEls.forEach((r, i) => {
        r.value.textContent = String(values[i]);
        r.fill.style.width = `${(values[i] / 255) * 100}%`;
        r.row.classList.toggle('kbd-focus', rowIndex === i);
      });
    }
    refresh();

    modal.parentElement.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { rowIndex = (rowIndex + 2) % 3; playUiSound('move'); refresh(); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { rowIndex = (rowIndex + 1) % 3; playUiSound('move'); refresh(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { values[rowIndex] = Math.max(0, values[rowIndex] - 8); refresh(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { values[rowIndex] = Math.min(255, values[rowIndex] + 8); refresh(); e.preventDefault(); }
      else if (e.key === 'Enter') { playUiSound('confirm'); close(Theme.rgbToHex(values)); e.preventDefault(); }
      else if (e.key === 'Escape') { playUiSound('back'); close(null); e.preventDefault(); }
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
  const content = buildScreen(appEl, 'Menu Color', `Accent ${state.themeColor.toUpperCase()} · ${capitalize(state.themeMode)} mode — everything else matches automatically.`);
  const goBack = () => goTo('settings');

  async function applyTheming(themeColor, themeMode) {
    await window.api.saveSettings({ themeColor, themeMode });
    state.themeColor = themeColor;
    state.themeMode = themeMode;
    state.theme = Theme.computeTheme(themeColor, themeMode);
    applyTheme();
    render();
  }

  async function activateColorEntry(entry) {
    if (entry.kind === 'swatch') await applyTheming(entry.hex, state.themeMode);
    else if (entry.kind === 'mode') await applyTheming(state.themeColor, entry.mode);
    else if (entry.kind === 'custom') {
      const hex = await showCustomColorModal(state.themeColor);
      if (hex) await applyTheming(hex, state.themeMode);
    } else if (entry.kind === 'back') goBack();
  }

  const entries = [
    { kind: 'mode', mode: 'dark', name: 'Dark Mode' },
    { kind: 'mode', mode: 'light', name: 'Light Mode' },
    ...PRESET_ACCENTS.map(([hex, name]) => ({ kind: 'swatch', hex, name })),
    { kind: 'custom', name: 'Custom Color' },
    { kind: 'back', name: 'Back' },
  ];

  const { el: gridEl, items } = buildTileCollection(entries, activateColorEntry, {
    tileOptions: (entry) => ({
      art: colorTileArt(entry),
      action: entry.kind === 'back' ? 'Back' : 'Select',
      active: (entry.kind === 'swatch' && entry.hex.toLowerCase() === state.themeColor.toLowerCase())
        || (entry.kind === 'mode' && entry.mode === state.themeMode),
    }),
  });
  content.appendChild(gridEl);

  const nav = create2DNav(items, countGridColumns(items), { onEscape: goBack });
  currentKeyHandler = (e) => nav.handleKey(e);
  setHints(HINTS.grid);
}

/* ---------- init ---------- */

const STATE_KEYS = [
  'apps', 'user', 'themeColor', 'themeMode', 'fontPath', 'fontFamily', 'fontSize', 'customFonts',
  'timezone', 'timeFormat', 'timezones', 'showSeconds', 'musicPath', 'musicVolume', 'musicMuted',
  'customMusic', 'uiSounds', 'customUiSounds',
];

async function init() {
  const data = await window.api.getState();
  for (const key of STATE_KEYS) state[key] = data[key];
  state.theme = Theme.computeTheme(state.themeColor, state.themeMode);
  applyTheme();
  if (state.fontPath && state.fontFamily) {
    applyCustomFont(state.fontPath, state.fontFamily);
    const activeFileName = baseName(state.fontPath);
    applyCustomFontScale(state.customFonts.find((f) => f.fileName === activeFileName)?.scale || 1);
  }
  applyFontSize(state.fontSize);
  setupBackgroundMusic();

  window.api.onAppsUpdated((apps) => {
    state.apps = apps;
    if (ui.screen === 'menu') render();
  });
  window.api.onGameExited(() => playBackgroundMusic());

  requestAnimationFrame(pollGamepads);
  render();
}

window.addEventListener('DOMContentLoaded', init);
