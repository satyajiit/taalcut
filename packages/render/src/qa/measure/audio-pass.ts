// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Loudness and level of the render's first audio stream in one decode
 * (docs/qa-gate.md, "Audio passes"): ebur128 with true peak, and
 * volumedetect for silence. FFmpeg has no GPU audio filters; this is ADR
 * 0002's accepted CPU exception, recorded once per process by the engine.
 *
 * TODO(media): swap for media's measureLoudness once P2-L4/L5 land.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { FfmpegFailed, runFfmpeg, type MediaContext } from '@taalcut/media';

export interface AudioLevels {
  /** EBU R128 integrated loudness; −70 (the gate) for silence. */
  readonly integratedLufs: number;
  readonly loudnessRangeLu: number;
  /** True peak in dBTP; −Infinity for digital silence. */
  readonly truePeakDbtp: number;
  /** volumedetect's max_volume in dB; it measures on s16, so digital silence reads −91 dB (or −inf). */
  readonly maxVolumeDb: number;
  readonly meanVolumeDb: number;
}

const NUMBER = '(-?inf|-?\\d+(?:\\.\\d+)?)';

function grab(text: string, pattern: string): number | undefined {
  const match = new RegExp(pattern).exec(text);
  if (!match) return undefined;
  const raw = match[1]!;
  if (raw === '-inf') return -Infinity;
  if (raw === 'inf') return Infinity;
  return Number(raw);
}

/** Parses the ebur128 summary and volumedetect lines from FFmpeg's log. Pure. */
export function parseAudioLevels(log: string): AudioLevels | undefined {
  // The summary comes last; read from it so per-frame lines (if any) can't match first.
  const summary = log.slice(Math.max(0, log.lastIndexOf('Summary:')));
  const integratedLufs = grab(summary, `I:\\s+${NUMBER} LUFS`);
  const loudnessRangeLu = grab(summary, `LRA:\\s+${NUMBER} LU`);
  const truePeakDbtp = grab(summary, `Peak:\\s+${NUMBER} dBFS`);
  const maxVolumeDb = grab(log, `max_volume: ${NUMBER} dB`);
  const meanVolumeDb = grab(log, `mean_volume: ${NUMBER} dB`);
  if (integratedLufs === undefined || maxVolumeDb === undefined) return undefined;
  return {
    integratedLufs,
    loudnessRangeLu: loudnessRangeLu ?? 0,
    truePeakDbtp: truePeakDbtp ?? -Infinity,
    maxVolumeDb,
    meanVolumeDb: meanVolumeDb ?? -Infinity,
  };
}

export async function measureAudioLevels(
  ctx: MediaContext,
  path: string,
  signal?: AbortSignal,
): AsyncResult<AudioLevels> {
  const result = await runFfmpeg(
    ctx,
    ['-v', 'info', '-i', path, '-map', '0:a:0', '-af', 'ebur128=peak=true:framelog=quiet,volumedetect', '-f', 'null', '-'],
    // Sound only: no video session (IX3-K2).
    { holdsVideoSession: false, timeoutMs: 300_000, stderrTailBytes: 64 * 1024, ...(signal ? { signal } : {}) },
  );
  if (!result.ok) return result;
  const levels = parseAudioLevels(result.value.stderrTail);
  if (!levels) return err(FfmpegFailed({ exitCode: 0 }, { detail: 'No ebur128 summary in the log' }));
  return ok(levels);
}
