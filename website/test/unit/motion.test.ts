// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DUR, EASE_IN, EASE_IN_OUT, EASE_OUT, KEEP_TIME_MIN_BEAT_MS, keepTimeBeatMs, staggerDelay } from '#lib/motion';
import { REPO_ROOT } from './source-files';

const tokens = readFileSync(join(REPO_ROOT, 'design/tokens/tailwind.css'), 'utf8');
const token = (name: string) => tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();

describe('motion constants', () => {
  it('match the design tokens', () => {
    expect(token('dur-micro')).toBe(`${DUR.micro * 1000}ms`);
    expect(token('dur-short')).toBe(`${DUR.short * 1000}ms`);
    expect(token('dur-long')).toBe(`${DUR.long * 1000}ms`);
    expect(token('ease-out')).toBe(`cubic-bezier(${EASE_OUT.join(', ')})`);
    expect(token('ease-in')).toBe(`cubic-bezier(${EASE_IN.join(', ')})`);
    expect(token('ease-in-out')).toBe(`cubic-bezier(${EASE_IN_OUT.join(', ')})`);
  });

  it('caps the arrival cascade at 240 ms', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(3)).toBeCloseTo(0.12);
    expect(staggerDelay(40)).toBe(0.24);
  });

  it('folds a tempo into the logo’s range and never strikes faster than 1.5 a second', () => {
    expect(keepTimeBeatMs(120)).toBe(KEEP_TIME_MIN_BEAT_MS);
    expect(keepTimeBeatMs(60)).toBe(1000);
    expect(keepTimeBeatMs(30)).toBe(1000);
    expect(keepTimeBeatMs(240)).toBe(KEEP_TIME_MIN_BEAT_MS);
    expect(keepTimeBeatMs(80)).toBe(750);
  });
});
