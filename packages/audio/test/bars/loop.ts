// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: a small piece of music with known bars, for the bar finder's tests: four beats to the bar, a kick on one
 * and three, a noise snare on two and four, a hat between the beats, and a bass note that changes with each bar
 * over a two-bar phrase. From `dropAt` on, a pad joins and everything is louder. Seeded, so every run hears the
 * same samples.
 */
import { mixAt, noise, silence, SR, tone } from '../listen/dsp-signals';

export interface LoopSpec {
  readonly seconds: number;
  /** One beat, in seconds. */
  readonly beat: number;
  /** When the first bar line is, in seconds; beats before it are a pickup. */
  readonly firstBar: number;
  /** Where the music gets louder and a pad joins; absent: it never does. */
  readonly dropAt?: number;
  readonly beatsPerBar?: number;
}

function decaying(samples: Float32Array, seconds: number): Float32Array {
  for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] ?? 0) * Math.exp(-i / (seconds * SR));
  return samples;
}

/** The bar lines of a loop, in seconds. */
export function loopBars(spec: LoopSpec): number[] {
  const bar = spec.beat * (spec.beatsPerBar ?? 4);
  const out: number[] = [];
  for (let at = spec.firstBar; at < spec.seconds - 0.05; at += bar) out.push(at);
  return out;
}

export function loop(spec: LoopSpec): Float32Array {
  const perBar = spec.beatsPerBar ?? 4;
  const out = silence(spec.seconds);
  mixAt(out, noise(spec.seconds, 0.0005, 11), 0);
  const pickup = Math.floor(spec.firstBar / spec.beat + 1e-9);
  const first = spec.firstBar - pickup * spec.beat;
  for (let index = 0, at = first; at < spec.seconds - 0.05; index++, at = first + index * spec.beat) {
    // The beat's place in its bar: 0 is the bar line.
    const inBar = (((index - pickup) % perBar) + perBar) % perBar;
    const bar = Math.floor((index - pickup) / perBar);
    const loud = spec.dropAt !== undefined && at >= spec.dropAt - 1e-6 ? 1.6 : 1;
    if (inBar % 2 === 0) mixAt(out, decaying(tone(60, 0.25, 0.5), 0.07), at, loud * (inBar === 0 ? 1 : 0.8));
    else mixAt(out, decaying(noise(0.12, 0.25, 30 + inBar), 0.03), at, loud);
    mixAt(out, decaying(noise(0.03, 0.08, 50), 0.008), at + spec.beat / 2, loud);
    if (inBar === 0) {
      const hz = bar % 2 === 0 ? 110 : 146.83;
      mixAt(out, decaying(tone(hz, perBar * spec.beat, 0.12), 1.2), at, loud);
    }
  }
  if (spec.dropAt !== undefined) mixAt(out, tone(330, spec.seconds - spec.dropAt, 0.1), spec.dropAt);
  return out;
}
