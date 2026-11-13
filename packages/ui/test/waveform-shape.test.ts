// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// REF1 (keep's request 41): a template read before keep's 04e87739 has a flat waveform, more than half its peaks
// exactly 1. Its strip draws it as none: the slot cuts and the beats, no flat band.
import type { Template } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { drawWaveform, flattenedWaveform, reelWaveform } from '../src/index';
import { templateFixture } from './template-fixture';

const withPeaks = (peaks: number[] | null): Template => {
  const template = templateFixture();
  const rate = template.audio.waveform!.rate;
  return { ...template, audio: { ...template.audio, waveform: peaks ? { rate, peaks } : null } };
};

/** As the breakdown stored it before the fix: the clamp left 663 of 666 peaks at 1. */
const flat = Array.from({ length: 666 }, (_, i) => (i % 222 === 5 ? 0.84 : 1));
/** Scaled to its loudest frame: 1 once. */
const shaped = Array.from({ length: 666 }, (_, i) => (i === 300 ? 1 : ((i * 7) % 25) / 25));

describe('flattenedWaveform', () => {
  it('is true when more than half the peaks are exactly 1', () => {
    expect(flattenedWaveform(flat)).toBe(true);
    expect(flattenedWaveform([1, 1, 0.5])).toBe(true);
  });

  it('is false for a scaled waveform, half ones, or no peaks', () => {
    expect(flattenedWaveform(shaped)).toBe(false);
    expect(flattenedWaveform([1, 1, 0.5, 0.5])).toBe(false);
    expect(flattenedWaveform([])).toBe(false);
  });
});

describe('reelWaveform', () => {
  it('gives a shaped waveform, and none for a flat one, an empty one or none', () => {
    const scaled = withPeaks(shaped);
    expect(reelWaveform(scaled)).toBe(scaled.audio.waveform);
    expect(reelWaveform(withPeaks(flat))).toBeNull();
    expect(reelWaveform(withPeaks([]))).toBeNull();
    expect(reelWaveform(withPeaks(null))).toBeNull();
  });
});

describe('drawWaveform with a flat waveform', () => {
  /** The fill colour of each rectangle drawn. */
  function fills(template: Template): string[] {
    const drawn: string[] = [];
    let style = '';
    const context = {
      clearRect: () => undefined,
      set fillStyle(value: string) {
        style = value;
      },
      fillRect: () => drawn.push(style),
    } as unknown as CanvasRenderingContext2D;
    const colours = {
      '--color-beat': 'soft',
      '--color-beat-strong': 'strong',
      '--color-rule-strong': 'rule',
    };
    drawWaveform(context, template, 320, 56, colours, { start: 0, end: 1 });
    return drawn;
  }

  it('draws the cuts and the beats, as a template with no waveform does, and no band', () => {
    const none = fills(withPeaks(null));
    expect(fills(withPeaks(flat))).toEqual(none);
    expect(none).not.toContain('soft');
    expect(fills(withPeaks(shaped))).toContain('soft');
  });
});
