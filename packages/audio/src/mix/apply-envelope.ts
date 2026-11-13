// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A gain envelope applied to PCM in process: the planner's dry run before it hands the envelope to render. */
import type { GainPoint } from '@taalcut/core';
import type { Pcm } from '../pcm/pcm';

export function applyEnvelope(pcm: Pcm, points: readonly GainPoint[]): Pcm {
  if (points.length === 0) return pcm;
  const frames = pcm.channels[0]?.length ?? 0;
  const gains = new Float32Array(frames).fill(1);
  let index = 0;
  for (let s = 0; s < frames; s++) {
    while (index + 1 < points.length && (points[index + 1]?.sample ?? 0) < s) index++;
    const a = points[index];
    const b = points[index + 1];
    let db = a?.db ?? 0;
    if (a && b && s >= a.sample && b.sample > a.sample)
      db = a.db + ((b.db - a.db) * (s - a.sample)) / (b.sample - a.sample);
    else if (a && s < a.sample) db = a.db;
    gains[s] = 10 ** (db / 20);
  }
  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.map((channel) => channel.map((v, i) => v * (gains[i] ?? 1))),
  };
}
