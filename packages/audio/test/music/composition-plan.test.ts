// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { cleanMood, planComposition } from '../../src/music/composition-plan';

const downbeats = Array.from({ length: 200 }, (_, i) => i * 2000);

describe('planComposition', () => {
  it('covers the timeline plus the tail with chunks of 3–120 s ending on downbeats', () => {
    const chunks = planComposition({
      durationMs: 30_000,
      bpm: 120,
      downbeatsMs: downbeats,
      mood: ['Warm', 'lo-fi'],
    });
    const total = chunks.reduce((sum, c) => sum + c.durationMs, 0);
    expect(total).toBe(32_000);
    for (const c of chunks) {
      expect(c.durationMs).toBeGreaterThanOrEqual(3000);
      expect(c.durationMs).toBeLessThanOrEqual(120_000);
      expect(c.positiveStyles).toEqual(['120 BPM', '4/4', 'warm', 'lo-fi', 'instrumental']);
      expect(c.negativeStyles).toContain('vocals');
      expect(c.text.length).toBeLessThanOrEqual(200);
    }
    expect(
      chunks
        .slice(0, -1)
        .every((c, i) => downbeats.includes(chunks.slice(0, i + 1).reduce((s, x) => s + x.durationMs, 0))),
    ).toBe(true);
  });

  it('splits sections longer than 120 s and keeps vocals out unless asked', () => {
    const chunks = planComposition({
      durationMs: 300_000,
      bpm: 90,
      downbeatsMs: downbeats,
      sections: [{ role: 'body', startMs: 0 }],
      vocals: true,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0]?.positiveStyles).not.toContain('instrumental');
    expect(chunks[0]?.negativeStyles).not.toContain('vocals');
  });

  it('lets only plain mood words through', () => {
    expect(cleanMood(['Happy', 'in the style of Some Artist!', 'chill', 'x'])).toEqual(['happy', 'chill']);
  });
});
