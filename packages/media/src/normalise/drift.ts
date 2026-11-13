// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio drift from the last packet's PTS + duration, not the container
 * duration (AAC frames are 21.3 ms, so the container lies).
 */
import { ok, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '../ffmpeg';
import { runFfprobe as ffprobe } from '../probe/run-ffprobe';

export interface DriftReading {
  readonly driftMs: number;
  readonly frames: number;
  readonly width: number;
  readonly height: number;
}

function lastEnd(csv: string): number | undefined {
  const lines = csv
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (!last) return undefined;
  const [pts, duration] = last.split(',');
  const end = Number(pts) + Number(duration);
  return Number.isFinite(end) ? end : undefined;
}

export async function measureDrift(
  path: string,
  ctx: MediaContext,
  signal?: AbortSignal,
): AsyncResult<DriftReading> {
  const videoPackets = await ffprobe(
    ctx,
    ['-select_streams', 'v:0', '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', path],
    signal,
  );
  if (!videoPackets.ok) return videoPackets;
  const audioPackets = await ffprobe(
    ctx,
    ['-select_streams', 'a:0', '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', path],
    signal,
  );
  if (!audioPackets.ok) return audioPackets;
  const shape = await ffprobe(
    ctx,
    [
      '-select_streams',
      'v:0',
      '-count_packets',
      '-show_entries',
      'stream=width,height,nb_read_packets',
      '-of',
      'csv=p=0',
      path,
    ],
    signal,
  );
  if (!shape.ok) return shape;
  const [width, height, frames] = shape.value.trim().split(',');
  const videoEnd = lastEnd(videoPackets.value);
  const audioEnd = lastEnd(audioPackets.value);
  const driftMs =
    videoEnd === undefined || audioEnd === undefined ? 0 : Math.round((audioEnd - videoEnd) * 1000);
  return ok({
    driftMs,
    frames: Number(frames) || 0,
    width: Number(width) || 0,
    height: Number(height) || 0,
  });
}
