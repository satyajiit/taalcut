// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The showcases' clock: 30 frames a second, the app's default canvas rate for a vertical reel. */
export const FPS = 30;
export const FRAME = 1 / FPS;

/** A time snapped to the nearest frame, so keyboard moves never drift. */
export function toFrame(seconds: number): number {
  return Math.round(seconds * FPS) / FPS;
}

/** "0:05.37" with hundredths, "0:05" without: a timecode set in JetBrains Mono (base.css, .tc-mono). */
export function formatTime(seconds: number, fraction = true): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  if (!fraction) return `${minutes}:${String(Math.floor(rest)).padStart(2, '0')}`;
  const hundredths = Math.round(rest * 100);
  const whole = Math.floor(hundredths / 100);
  return `${minutes}:${String(whole).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
}

/** A length in words, as the app's chips say it: "14 s", "2.4 s". */
export function formatLength(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} s`;
}

/** Where a time sits on a track, as a CSS percentage. */
export function pct(seconds: number, total: number): string {
  return `${(Math.min(Math.max(seconds, 0), total) / Math.max(total, 0.001)) * 100}%`;
}
