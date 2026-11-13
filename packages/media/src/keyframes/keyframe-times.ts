// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a file's keyframes are: the presentation time in seconds of every keyframe packet of the first video
 * stream, ascending (ffprobe's packet flags: a demux, no decode). For measurements and tests that need to know
 * where a seek or a keyframe read lands (vision's `bench:embed-frames`, the keyframe tests). The file goes to
 * ffprobe as every user file does (`file:` and the demuxer allow-list, as `probeArgs`), and a packet without a time
 * (`N/A`) is left out (IX2-F16).
 */
import { ok, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '../ffmpeg';
import { fileInput, stillPipeDemuxer, USER_MEDIA_INPUT } from '../input';
import { runFfprobe } from '../probe/run-ffprobe';

export async function keyframeTimes(
  ctx: MediaContext,
  path: string,
  signal?: AbortSignal,
): AsyncResult<number[]> {
  const still = stillPipeDemuxer(path);
  const packets = await runFfprobe(
    ctx,
    [
      '-select_streams',
      'v:0',
      '-show_entries',
      'packet=pts_time,flags',
      '-of',
      'csv=p=0',
      ...USER_MEDIA_INPUT,
      ...(still ? ['-f', still] : []),
      '-i',
      fileInput(path),
    ],
    signal,
  );
  if (!packets.ok) return packets;
  return ok(
    packets.value
      .split('\n')
      .map((line) => line.split(','))
      .filter(([, flags]) => flags?.includes('K') === true)
      .map(([time]) => (time?.trim() ? Number(time) : Number.NaN))
      .filter((time) => Number.isFinite(time))
      .sort((a, b) => a - b),
  );
}
