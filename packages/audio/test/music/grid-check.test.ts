// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { checkGrid } from '../../src/music/grid-check';

const target = { beatsMs: Array.from({ length: 20 }, (_, i) => i * 500), downbeats: [0, 4, 8, 12, 16] };

describe('checkGrid', () => {
  it('passes beats within a frame and reports the errors', () => {
    const tracked = { beatsMs: target.beatsMs.map((t, i) => t + (i % 3) * 5), downbeats: [] };
    const result = checkGrid({ target, tracked, frameMs: 1000 / 30, musicMs: 10_000 });
    expect(result).toMatchObject({ passed: true, maxErrorMs: 10, missed: 0, downbeatsOnGrid: true });
  });

  it('fails a downbeat a frame late even when p95 holds', () => {
    const tracked = { beatsMs: target.beatsMs.map((t, i) => (i === 8 ? t + 40 : t)), downbeats: [] };
    const result = checkGrid({ target, tracked, frameMs: 1000 / 30, musicMs: 10_000 });
    expect(result.downbeatsOnGrid).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('counts misses against it and skips beats past the music', () => {
    const tracked = { beatsMs: target.beatsMs.filter((_, i) => i % 7 !== 3), downbeats: [] };
    const result = checkGrid({ target, tracked, frameMs: 1000 / 30, musicMs: 10_000 });
    expect(result.missed).toBeGreaterThan(0.05);
    expect(result.passed).toBe(false);
    const short = checkGrid({ target, tracked: target, frameMs: 1000 / 30, musicMs: 2000 });
    expect(short.passed).toBe(true);
  });
});
