// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// Colour maths for the token build (OKLCH → sRGB, WCAG 2 ratio, APCA Lc). Zero dependencies.

export function oklchToLinear([L, C, H]) {
  const l = L / 100;
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}
export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
export const inGamut = (lin) => lin.every((v) => v >= -0.0005 && v <= 1.0005);

export function hex(c) {
  return (
    '#' +
    oklchToLinear(c)
      .map((v) =>
        Math.round(clamp01(encode(clamp01(v))) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function luminance(c) {
  const [r, g, b] = oklchToLinear(c).map(clamp01);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// APCA-W3 0.1.9 (https://github.com/Myndex/apca-w3), the constants of its reference implementation. Its input is
// 8-bit sRGB, so each colour is quantised to the hex the report prints before it is measured. Positive Lc is dark
// text on a light background, negative is light on dark; callers compare the magnitude.
const APCA = {
  trc: 2.4,
  r: 0.2126729,
  g: 0.7151522,
  b: 0.072175,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scale: 1.14,
  offset: 0.027,
  deltaYmin: 0.0005,
  loClip: 0.1,
};
function apcaY(rgb) {
  const [r, g, b] = rgb.map((v) => (v / 255) ** APCA.trc);
  const y = APCA.r * r + APCA.g * g + APCA.b * b;
  return y > APCA.blkThrs ? y : y + (APCA.blkThrs - y) ** APCA.blkClmp;
}
export function apcaRgb(textRgb, bgRgb) {
  const yt = apcaY(textRgb);
  const yb = apcaY(bgRgb);
  if (Math.abs(yb - yt) < APCA.deltaYmin) return 0;
  if (yb > yt) {
    const s = (yb ** 0.56 - yt ** 0.57) * APCA.scale;
    return s < APCA.loClip ? 0 : (s - APCA.offset) * 100;
  }
  const s = (yb ** 0.65 - yt ** 0.62) * APCA.scale;
  return s > -APCA.loClip ? 0 : (s + APCA.offset) * 100;
}
export const rgb8 = (c) => oklchToLinear(c).map((v) => Math.round(clamp01(encode(clamp01(v))) * 255));
export const apca = (text, bg) => apcaRgb(rgb8(text), rgb8(bg));

// Known answers from the APCA-W3 0.1.9 test suite: text, background, Lc. The build refuses to run if the maths
// above drifts from them, so the gate can't pass on a broken formula.
const APCA_KNOWN = [
  [[0x88, 0x88, 0x88], [0xff, 0xff, 0xff], 63.056469930209424],
  [[0xff, 0xff, 0xff], [0x88, 0x88, 0x88], -68.54146436644962],
  [[0x00, 0x00, 0x00], [0xaa, 0xaa, 0xaa], 58.146262578561334],
  [[0xaa, 0xaa, 0xaa], [0x00, 0x00, 0x00], -56.24113336839742],
  [[0x11, 0x22, 0x33], [0xdd, 0xee, 0xff], 91.66830811481631],
  [[0xdd, 0xee, 0xff], [0x11, 0x22, 0x33], -93.06770049484275],
];
export function apcaSelfTest() {
  return APCA_KNOWN.filter(([t, b, lc]) => Math.abs(apcaRgb(t, b) - lc) > 1e-9).map(
    ([t, b, lc]) => `${t} on ${b}: expected ${lc}, got ${apcaRgb(t, b)}`,
  );
}
export const css = ([L, C, H]) => `oklch(${+L.toFixed(2)}% ${+C.toFixed(3)} ${+H.toFixed(1)})`;
