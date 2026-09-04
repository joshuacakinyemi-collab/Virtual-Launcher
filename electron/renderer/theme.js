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

  function computeTheme(baseHex, overrides) {
    const theme = {
      bg: darken(baseHex, 0.85),
      glow: lighten(baseHex, 0.25),
      tile: mix(baseHex, '#10141c', 0.75),
      tileOverlay: mix(baseHex, '#10141c', 0.55),
    };
    if (overrides) {
      if (overrides.glow) theme.glow = overrides.glow;
      if (overrides.tile) theme.tile = overrides.tile;
    }
    return theme;
  }

  global.Theme = { hexToRgb, rgbToHex, lighten, darken, mix, luminance, readableFg, computeTheme };
})(window);
