// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Counts the FFmpeg and ffprobe processes one job spawns and the video
 * decodes among them (IX-D6), so a stage's job output can say what it cost
 * and the bench can sum decodes per asset. A tally is per job: the handler
 * makes one, runs with `countedContext(ctx, tally)` and reports
 * `tally.snapshot()`. Counting wraps `ctx.runner`, through which every media,
 * vision and audio FFmpeg call already goes (the hardware session gate too).
 */
import { resolve } from 'node:path';
import type { DecodeRecorder, MediaContext } from '../ffmpeg';
import { keepGate } from '../hardware-sessions/runner';
import { runProcess, type ProcessRunner } from '../process/runner';
import { classifyCommand } from './classify';
import type { DecodeCount } from './schema';

export interface DecodeTally extends DecodeRecorder {
  /** Counts one command (the counting runner calls it before spawning). */
  record(command: string, args: readonly string[]): void;
  snapshot(): DecodeCount;
}

/** `original`: the asset's own file, so decodes of it are told apart from proxy and cache reads. */
export function createDecodeTally(original?: string): DecodeTally {
  const own = original === undefined ? undefined : resolve(original);
  const count = { ffmpeg: 0, ffprobe: 0, fullDecodes: 0, partialDecodes: 0, originalFullDecodes: 0 };
  return {
    record(command, args) {
      const seen = classifyCommand(command, args);
      if (seen.kind === 'ffprobe') count.ffprobe++;
      if (seen.kind !== 'ffmpeg') return;
      count.ffmpeg++;
      if (seen.decode === 'partial') count.partialDecodes++;
      if (seen.decode !== 'full') return;
      count.fullDecodes++;
      if (own !== undefined && seen.inputs.includes(own)) count.originalFullDecodes++;
    },
    recordDecode(decode, input) {
      if (decode === 'partial') {
        count.partialDecodes++;
        return;
      }
      count.fullDecodes++;
      if (own !== undefined && resolve(input) === own) count.originalFullDecodes++;
    },
    snapshot: () => ({ ...count }),
  };
}

/** A runner that records each command in `tally`, then runs it with `runner`; a gated runner stays gated. */
export function countingRunner(tally: DecodeTally, runner: ProcessRunner = runProcess): ProcessRunner {
  const counted: ProcessRunner = (command, args, options) => {
    tally.record(command, args);
    return runner(command, args, options);
  };
  return keepGate(runner, counted);
}

/** `ctx` with its runner counted in `tally`, and decodes outside FFmpeg counted there too. */
export function countedContext(ctx: MediaContext, tally: DecodeTally): MediaContext {
  return { ...ctx, runner: countingRunner(tally, ctx.runner), decodeTally: tally };
}
