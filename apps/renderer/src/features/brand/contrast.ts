// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** WCAG 2.2 contrast between two `#rrggbb` colours (1 to 21), for the brand kit's text-on-background line. */

/** The level text needs on its background (WCAG 1.4.3, AA). */
export const TEXT_CONTRAST = 4.5;

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** A hex colour as the Style stores it (`#rrggbb`, lower case), from what someone typed; null if it isn't one. */
export function normaliseHex(typed: string): string | null {
  const bare = typed.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(bare)) return `#${bare}`;
  if (/^[0-9a-f]{3}$/.test(bare)) return `#${[...bare].map((c) => c + c).join('')}`;
  return null;
}
