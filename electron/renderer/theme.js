(function (global) {
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }

  function rgbToHex(rgb) {
    // Python's _rgb_to_hex uses int(c), which truncates rather than rounds —
    // match that exactly so ported theme math produces identical colors.
    const clamp = (v) => Math.max(0, Math.min(255, Math.trunc(v)));
    return '#' + rgb.map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
  }

  function lighten(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
  }

  function darken(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex([r * (1 - amount), g * (1 - amount), b * (1 - amount)]);
  }

  function mix(hexA, hexB, t) {
    const [ar, ag, ab] = hexToRgb(hexA);
    const [br, bg, bb] = hexToRgb(hexB);
    return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
  }

  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function readableFg(hex, light, dark) {
    light = light || '#ffffff';
    dark = dark || '#20242a';
    return luminance(hex) > 0.6 ? dark : light;
  }

  // Neutral surface colors for the two modes — most of the menu (bg, tiles)
  // is built from these, not from the accent. Before this, bg/tile were
  // mixed 32-52% toward the accent itself, so a vivid accent colored
  // *everything*, leaving nothing neutral for it to stand out against.
  // Only a light accent tint (TINT below) carries through now, so the
  // accent still visibly ties into the theme without dominating it.
  const DARK_BASE = { bg: '#0a0e14', tile: '#1c2430', tileOverlay: '#2a3444' };
  const LIGHT_BASE = { bg: '#eef1f6', tile: '#ffffff', tileOverlay: '#e2e7f0' };
  const TINT = 0.08;

  function computeTheme(baseHex, mode) {
    const base = mode === 'light' ? LIGHT_BASE : DARK_BASE;
    return {
      bg: mix(base.bg, baseHex, TINT),
      glow: lighten(baseHex, 0.3),
      tile: mix(base.tile, baseHex, TINT),
      tileOverlay: mix(base.tileOverlay, baseHex, TINT * 1.5),
    };
  }

  global.Theme = { hexToRgb, rgbToHex, lighten, darken, mix, luminance, readableFg, computeTheme };
})(window);
