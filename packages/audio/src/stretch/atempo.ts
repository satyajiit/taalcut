// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FFmpeg's built-in `atempo` (LGPL, WSOLA) as the fallback engine: only when every ratio is within 0.90–1.10
 * (SPEC P3.5; above that WSOLA artefacts are audible and chaining it would cheat a large ratio). One FFmpeg run:
 * each segment is trimmed, stretched, then padded or cut to its exact target length, and the pieces concatenated.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CancelledError, err, ok } from '@taalcut/core';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { encodeFloatWav, fromInterleaved } from '../pcm/pcm';
import { StretchFailed, StretchUnavailable } from './errors';
import { checkSegments, segmentRatio } from './segments';
import type { StretchSegment, TimeStretcher } from './stretcher';

export const ATEMPO_RANGE = { min: 0.9, max: 1.1 } as const;

/** The first ratio atempo may not take, or null when every one is inside its range. */
export function atempoRefuses(segments: readonly StretchSegment[]): number | null {
  for (const segment of segments) {
    const ratio = segmentRatio(segment);
    if (!(ratio >= ATEMPO_RANGE.min && ratio <= ATEMPO_RANGE.max)) return ratio;
  }
  return null;
}

export function atempoGraph(segments: readonly StretchSegment[]): string {
  const parts = segments.map((segment, index) => {
    // atempo's tempo is input over output: a ratio above 1 (longer) is a tempo below 1.
    const tempo = 1 / segmentRatio(segment);
    return (
      `[0:a]atrim=start_sample=${segment.sourceStart}:end_sample=${segment.sourceEnd},asetpts=PTS-STARTPTS,` +
      `atempo=${tempo.toFixed(6)},apad=whole_len=${segment.targetLength},` +
      `atrim=end_sample=${segment.targetLength}[s${index}]`
    );
  });
  const inputs = segments.map((_, index) => `[s${index}]`).join('');
  return `${parts.join(';')};${inputs}concat=n=${segments.length}:v=0:a=1[out]`;
}

export function createAtempoStretcher(deps: {
  readonly media: MediaContext;
  readonly scratchDir?: string;
}): TimeStretcher {
  return {
    engine: 'atempo',
    async stretch(input, segments, signal) {
      if (signal?.aborted) return err(CancelledError());
      const checked = checkSegments(segments, input.channels[0]?.length ?? 0);
      if (!checked.ok) return checked;
      const refused = atempoRefuses(segments);
      if (refused !== null) return err(StretchUnavailable({ ratio: Number(refused.toFixed(4)) }));
      let dir: string | undefined;
      try {
        dir = await mkdtemp(join(deps.scratchDir ?? tmpdir(), 'taalcut-atempo-'));
        const source = join(dir, 'in.wav');
        await writeFile(source, encodeFloatWav(input));
        const channels = input.channels.length;
        const run = await runFfmpeg(
          deps.media,
          [
            '-nostdin',
            '-i',
            source,
            '-filter_complex',
            atempoGraph(segments),
            '-map',
            '[out]',
            '-ac',
            String(channels),
            '-ar',
            String(input.sampleRate),
            '-f',
            'f32le',
            '-acodec',
            'pcm_f32le',
            'pipe:1',
          ],
          // Audio only: a stop keeps SIGTERM then SIGKILL (IX3-K2).
          {
            holdsVideoSession: false,
            maxStdoutBytes: 1 << 30,
            timeoutMs: 180_000,
            ...(signal ? { signal } : {}),
          },
        );
        if (!run.ok) return run;
        return ok(fromInterleaved(run.value.stdout, channels, input.sampleRate));
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : 'atempo failed';
        return err(StretchFailed(undefined, { detail: detail.slice(0, 300) }));
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
