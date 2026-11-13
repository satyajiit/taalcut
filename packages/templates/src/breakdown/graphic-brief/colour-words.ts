// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ: a colour's everyday name ("white", "pale green", "dark blue") for a brief's words and the model's facts,
 * and the platform a set of message colours recalls. Pure; English, like every brief's words (they are data, shown
 * as the reel's text is).
 */
import type { GraphicPlatform } from '@taalcut/core';

function hsl(hex: string): { h: number; s: number; l: number } {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
  return { h, s, l };
}

const HUES: readonly (readonly [number, string])[] = [
  [15, 'red'],
  [40, 'orange'],
  [65, 'yellow'],
  [160, 'green'],
  [195, 'teal'],
  [250, 'blue'],
  [290, 'purple'],
  [335, 'pink'],
  [360, 'red'],
];

/** An everyday name for '#rrggbb'. */
export function colourWords(hex: string): string {
  const { h, s, l } = hsl(hex);
  if (s < 0.15 || l > 0.95 || l < 0.06) {
    if (l > 0.9) return 'white';
    if (l > 0.7) return 'light grey';
    if (l > 0.35) return 'grey';
    if (l > 0.12) return 'dark grey';
    return 'black';
  }
  const hue = HUES.find(([to]) => h < to)?.[1] ?? 'red';
  if (l > 0.75) return `pale ${hue}`;
  if (l < 0.3) return `dark ${hue}`;
  return hue;
}

/**
 * Whether a fill has a colour of its own, as a sender's bubble does (iMessage's blue, WhatsApp's green, Instagram's
 * purple), where the other side's is white, grey or black: its channels differ by 20 levels or more.
 */
export function isColourful(hex: string): boolean {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return Math.max(...channels) - Math.min(...channels) >= 20;
}

/**
 * The platform message bubbles recall from their measured colours and marks: read ticks or a pale green bubble are
 * WhatsApp's, a blue bubble iMessage's; anything else says nothing (null), and the model's reading stands.
 */
export function platformOfMessages(
  messages: readonly { readonly fill: string | null; readonly receipt: boolean }[],
): GraphicPlatform | null {
  if (messages.some((message) => message.receipt)) return 'whatsapp';
  const blue = messages.some((message) => {
    if (!message.fill) return false;
    const { h, s, l } = hsl(message.fill);
    return s > 0.5 && h >= 195 && h < 230 && l > 0.35 && l < 0.65;
  });
  if (blue) return 'imessage';
  const green = messages.some((message) => {
    if (!message.fill || !isColourful(message.fill)) return false;
    const { h, l } = hsl(message.fill);
    return h >= 80 && h < 150 && l > 0.7;
  });
  return green ? 'whatsapp' : null;
}
