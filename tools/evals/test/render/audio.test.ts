// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { clickOnsets, clickPcm, driftFails } from '../../src/render/audio';

describe('click track', () => {
  it('finds clicks at frame 0 and frame 15 of a 30 fps second within 5 ms', () => {
    const pcm = clickPcm({ sampleRate: 48000, durationFrames: 30, fps: 30, beats: [0, 15] });
    const onsets = clickOnsets(pcm, 48000);
    expect(onsets).toHaveLength(2);
    const first = onsets[0];
    const second = onsets[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(Math.abs((first ?? 1) - 0)).toBeLessThan(0.005);
    expect(Math.abs((second ?? 0) - 0.5)).toBeLessThan(0.005);
    expect(driftFails(onsets, [0, 0.5])).toBe(false);
  });

  it('reads a 50 ms click as one onset, at its start', () => {
    const track = { sampleRate: 48000, durationFrames: 30, fps: 30, beats: [0, 15] };
    const onsets = clickOnsets(clickPcm({ ...track, clickSeconds: 0.05 }), 48000);
    expect(onsets).toHaveLength(2);
    expect(driftFails(onsets, [0, 0.5])).toBe(false);
    // 50 ms of 1 kHz is 2,400 samples; the 10 ms default is 480.
    const sounding = (pcm: Buffer) => {
      let count = 0;
      for (let at = 0; at < pcm.length; at += 2) if (pcm.readInt16LE(at) !== 0) count += 1;
      return count;
    };
    expect(sounding(clickPcm({ ...track, clickSeconds: 0.05 }))).toBeGreaterThan(
      4 * sounding(clickPcm(track)),
    );
  });
});
