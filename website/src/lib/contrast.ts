// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * WCAG contrast for the site's OKLCH tokens (WEB2 foundation). test/unit/tokens-contrast.test.ts reads every token
 * from src/app/globals.css and design/tokens/tailwind.css and holds each text and fill pair to AA with these. Pure:
 * no DOM, so a lane can check a pair it adds in a unit test of its own.
 */

/** An OKLCH colour: lightness 0–1, chroma, hue in degrees, alpha 0–1. */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly alpha: number;
}

/** Parses `oklch(62% 0.2 290)` or `oklch(0.62 0.2 290 / 0.5)`. Undefined for anything else. */
export function parseOklch(value: string): Oklch | undefined {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i.exec(value.trim());
  if (!m) return undefined;
  const l = Number(m[1]) / (m[2] === '%' ? 100 : 1);
  const alpha = m[5] === undefined ? 1 : Number(m[5]) / (m[6] === '%' ? 100 : 1);
  return { l, c: Number(m[3]), h: Number(m[4]), alpha };
}

/** OKLCH to linear sRGB, clipped to the sRGB gamut the way a browser paints it. */
export function oklchToLinearSrgb({ l, c, h }: Oklch): readonly [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clip(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clip(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clip(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

/** WCAG relative luminance. */
export function luminance(colour: Oklch): number {
  const [r, g, b] = oklchToLinearSrgb(colour);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two opaque colours, 1 to 21. */
export function contrast(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA: 4.5 for text, 3 for large text and for the parts of a control (a border, a focus ring, an icon). */
export const AA = { text: 4.5, large: 3, ui: 3 } as const;
