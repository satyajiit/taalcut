// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Non-silent stretches. Loudness is media's `measureLoudness`; silence
 * detection is not a media primitive, so this stays a `silencedetect` pass.
 */
import { basename, resolve } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { probeMedia, runFfmpeg, toSeconds, type MediaContext, type ProbeResult } from '@taalcut/media';
import { AUDIO_CONFIG } from '../config';
import { NoAudio } from '../errors';
import { parseSilenceLog, reportsNoAudio } from './silence-log';

export interface SilenceWindow {
  readonly signal?: AbortSignal;
  /** File-clock window. Input seek (`-ss` before `-i`) resets timestamps. */
  readonly range?: { startMs: number; endMs: number };
}

function noAudio(path: string, detail?: string) {
  return err(NoAudio({ name: basename(path) || path }, detail ? { detail } : {}));
}

function seconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

function durationMsOf(probe: ProbeResult): number | undefined {
  const time = probe.audio?.duration ?? probe.duration;
  if (!time || !(time.rate > 0)) return undefined;
  return Math.round(toSeconds(time) * 1000);
}

function durationMsFromStderr(stderr: string): number | undefined {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  return Math.round(((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000);
}

/** Silences inside the window. A silence that never ends runs to `durationMs`. */
export async function detectSilences(
  ctx: MediaContext,
  path: string,
  options?: SilenceWindow,
): AsyncResult<{ durationMs: number; silences: { startMs: number; endMs: number }[] }> {
  const probed = await probeMedia(path, ctx, options?.signal ? { signal: options.signal } : {});
  if (!probed.ok) {
    if (reportsNoAudio(probed.error.detail ?? '') || probed.error.code === 'media.file_not_found')
      return noAudio(path);
    return probed;
  }
  if (!probed.value.audio) return noAudio(path);
  const fileMs = durationMsOf(probed.value);
  const range = options?.range;
  const { noiseDb, minSilenceSec } = AUDIO_CONFIG.silence;
  const result = await runFfmpeg(
    ctx,
    [
      '-loglevel',
      'info',
      ...(range ? ['-ss', seconds(range.startMs)] : []),
      '-i',
      `file:${resolve(path)}`,
      ...(range ? ['-t', seconds(range.endMs - range.startMs)] : []),
      '-vn',
      '-af',
      `silencedetect=noise=${noiseDb}dB:d=${minSilenceSec}`,
      '-f',
      'null',
      '-',
    ],
    // Audio only: a stop keeps SIGTERM then SIGKILL (IX3-K2).
    { holdsVideoSession: false, ...(options?.signal ? { signal: options.signal } : {}) },
  );
  if (!result.ok) {
    if (reportsNoAudio(result.error.detail ?? '')) return noAudio(path, result.error.detail);
    return result;
  }
  const stderr = result.value.stderrTail;
  let durationMs: number | undefined;
  if (range) {
    const end = fileMs === undefined ? range.endMs : Math.min(range.endMs, fileMs);
    durationMs = Math.max(0, end - Math.max(0, range.startMs));
  } else {
    durationMs = fileMs ?? durationMsFromStderr(stderr);
  }
  if (durationMs === undefined) return noAudio(path, 'could not read duration');
  return ok({ durationMs, silences: parseSilenceLog(stderr, durationMs) });
}
