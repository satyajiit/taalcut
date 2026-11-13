// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Signalsmith Stretch engine (MIT, vendored WebAssembly; third_party/signalsmith-stretch). Offline and exact:
 * the README's recipe for a fixed-length sound. `seek` primes the first `inputLatency()` samples so processing
 * time starts at the first source sample; each `process` call consumes input `inputLatency()` ahead of the
 * processing time and produces output whose length follows the segment's ratio, with the rounding error carried
 * so every segment boundary lands on its exact output sample; `flush` reads the tail; the `outputLatency()`
 * pre-roll is trimmed, so output sample 0 is the first source sample (SPEC P3.5: otherwise the downbeat moves).
 */
import loadSignalsmith, { type SignalsmithStretchModule } from '@taalcut-vendor/signalsmith-stretch';
import { CancelledError, err, ok, type AsyncResult, type Result } from '@taalcut/core';
import type { Pcm } from '../pcm/pcm';
import { StretchFailed } from './errors';
import { checkSegments, segmentRatio } from './segments';
import type { StretchSegment, TimeStretcher } from './stretcher';

/** Input samples per process call; small enough that output stays inside the buffers at a 2× ratio. */
const BLOCK_IN = 1024;

export async function loadSignalsmithModule(): AsyncResult<SignalsmithStretchModule> {
  try {
    return ok(await loadSignalsmith());
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'the WebAssembly module did not load';
    return err(StretchFailed(undefined, { detail: detail.slice(0, 300) }));
  }
}

export function createSignalsmithStretcher(module: SignalsmithStretchModule): TimeStretcher {
  return {
    engine: 'signalsmith',
    async stretch(input, segments, signal) {
      if (signal?.aborted) return err(CancelledError());
      const checked = checkSegments(segments, input.channels[0]?.length ?? 0);
      if (!checked.ok) return checked;
      try {
        return run(module, input, segments, signal);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : 'stretch failed';
        return err(StretchFailed(undefined, { detail: detail.slice(0, 300) }));
      }
    },
  };
}

interface Buffers {
  readonly length: number;
  readonly inOffsets: readonly number[];
  readonly outOffsets: readonly number[];
}

function allocate(module: SignalsmithStretchModule, channels: number, length: number): Buffers {
  const pointer = module._setBuffers(channels, length);
  const bytes = length * 4;
  return {
    length,
    inOffsets: Array.from({ length: channels }, (_, c) => pointer + bytes * c),
    outOffsets: Array.from({ length: channels }, (_, c) => pointer + bytes * (c + channels)),
  };
}

/** Copies `count` source samples from `from` into the input buffers; past the source end is silence. */
function feed(
  module: SignalsmithStretchModule,
  buffers: Buffers,
  input: Pcm,
  from: number,
  count: number,
): void {
  const memory = module.HEAP8.buffer;
  input.channels.forEach((channel, c) => {
    const view = new Float32Array(memory, buffers.inOffsets[c], count);
    for (let i = 0; i < count; i++) {
      const at = from + i;
      view[i] = at >= 0 && at < channel.length ? (channel[at] ?? 0) : 0;
    }
  });
}

function drain(
  module: SignalsmithStretchModule,
  buffers: Buffers,
  out: Float32Array[],
  at: number,
  count: number,
): void {
  const memory = module.HEAP8.buffer;
  out.forEach((channel, c) => {
    const view = new Float32Array(memory, buffers.outOffsets[c], count);
    for (let i = 0; i < count; i++) {
      const position = at + i;
      if (position >= 0 && position < channel.length) channel[position] = view[i] ?? 0;
    }
  });
}

/** Output sample (before the pre-roll trim) at which processing time `t` lands, from the segments' linear maps. */
function targetAt(segments: readonly StretchSegment[], starts: readonly number[], t: number): number {
  const origin = segments[0]?.sourceStart ?? 0;
  for (const [index, segment] of segments.entries()) {
    const span = segment.sourceEnd - segment.sourceStart;
    const local = t + origin - segment.sourceStart;
    if (local <= span) return (starts[index] ?? 0) + Math.round((local * segment.targetLength) / span);
  }
  return starts[segments.length] ?? 0;
}

function run(
  module: SignalsmithStretchModule,
  input: Pcm,
  segments: readonly StretchSegment[],
  signal?: AbortSignal,
): Result<Pcm> {
  const channels = input.channels.length;
  module._presetDefault(channels, input.sampleRate);
  const inLatency = module._inputLatency();
  const outLatency = module._outputLatency();
  const buffers = allocate(module, channels, Math.max(inLatency, outLatency, 4 * BLOCK_IN));
  const origin = segments[0]?.sourceStart ?? 0;
  const sourceLength = (segments.at(-1)?.sourceEnd ?? origin) - origin;
  const starts = [0];
  for (const segment of segments) starts.push((starts.at(-1) ?? 0) + segment.targetLength);
  const total = starts.at(-1) ?? 0;
  const out = input.channels.map(() => new Float32Array(total));

  feed(module, buffers, input, origin, inLatency);
  module._seek(inLatency, 1 / segmentRatio(segments[0] ?? { sourceStart: 0, sourceEnd: 1, targetLength: 1 }));
  // Written output position, counted from the start of the pre-roll.
  let written = 0;
  let time = 0;
  while (time < sourceLength) {
    if (signal?.aborted) return err(CancelledError());
    const step = Math.min(BLOCK_IN, sourceLength - time);
    const outCount = targetAt(segments, starts, time + step) - targetAt(segments, starts, time);
    feed(module, buffers, input, origin + time + inLatency, step);
    module._process(step, outCount);
    drain(module, buffers, out, written - outLatency, outCount);
    written += outCount;
    time += step;
  }
  // The input read-ahead already ran past the end with silence; the tail is the last outputLatency samples.
  module._flush(outLatency);
  drain(module, buffers, out, written - outLatency, outLatency);
  return ok({ sampleRate: input.sampleRate, channels: out });
}
