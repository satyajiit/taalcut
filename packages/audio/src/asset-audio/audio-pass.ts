// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One FFmpeg pass over an asset's sound (IX-A1). `asplit` feeds two branches from one decode:
 * - the meter: the stream at its source rate through `ebur128` (true peak on, so loudness stays what media's
 *   `measureLoudness` reports) and `silencedetect`, timestamps reset to the first sample;
 * - the speech PCM: normalise's align filter (pad or trim to the video start, cut at the video end), the mono
 *   downmix and 16 kHz, written as one 16-bit WAV, the same samples media's `extractAudio` writes for whisper.
 * Language ID, voice detection and the transcript all read that WAV; nothing decodes the original again.
 * Neither filter has a GPU path: the pass's owner reports media's `media.analysisFilters` record (once per process).
 */
import { resolve } from 'node:path';
import { err, ok, RationalTime, type AsyncResult } from '@taalcut/core';
import {
  normalisationGraph,
  parseEbur128,
  runFfmpeg,
  USER_MEDIA_DEMUXERS,
  type LoudnessReading,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import { AUDIO_CONFIG } from '../config';
import { NoAudio } from '../errors';
import { parseSilenceLog, reportsNoAudio, SILENCE_LINE, type Silence } from '../measure/silence-log';
import { readSpeechPcm, SPEECH_RATE, type SpeechPcm } from './wav-file';

/** As media's extractAudio: force stereo, then average, so a mono source survives the pan. */
const DOWNMIX = 'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1';
/** Log lines the pass keeps: silences and ebur128's summary. Everything else is dropped as it streams. */
const KEEP = new RegExp(`${SILENCE_LINE.source}|Summary|I:|LRA|Peak|Integrated|True peak|Loudness range`);
/** Floor for the pass, plus this much per second of sound (it runs at 200–250× real time on an M-series Mac). */
const TIMEOUT_FLOOR_MS = 120_000;
const TIMEOUT_PER_SECOND_MS = 50;

export interface AudioPassResult {
  readonly loudness: LoudnessReading;
  /** On the asset clock (the PCM's), clamped to it, sorted; the pad before a late audio start is one. */
  readonly silences: readonly Silence[];
  readonly pcm: SpeechPcm;
}

export interface AudioPassRequest {
  readonly path: string;
  readonly plan: NormalisationPlan;
  /** Where the speech WAV goes. */
  readonly out: string;
  readonly signal?: AbortSignal;
}

function seconds(time: RationalTime): number {
  return RationalTime.toSeconds(time);
}

/** The pass's FFmpeg arguments (after media's prelude). */
export function audioPassArgs(path: string, plan: NormalisationPlan, out: string): string[] {
  const graph = normalisationGraph(plan, {
    route: plan.decode,
    toneMap: { method: 'none', backend: 'software' },
  });
  const align = graph.audioFilter ? `${graph.audioFilter},` : '';
  const { noiseDb, minSilenceSec } = AUDIO_CONFIG.silence;
  const meter = `asetpts=PTS-STARTPTS,ebur128=peak=true:framelog=quiet,silencedetect=noise=${noiseDb}dB:d=${minSilenceSec},anullsink`;
  const speech = `${align}${DOWNMIX},aresample=${SPEECH_RATE}`;
  return [
    '-y',
    '-loglevel',
    'info',
    '-protocol_whitelist',
    'file',
    '-format_whitelist',
    USER_MEDIA_DEMUXERS.join(','),
    '-i',
    `file:${resolve(path)}`,
    '-filter_complex',
    `[0:a:0]asplit=2[meter][speech];[meter]${meter};[speech]${speech}[pcm]`,
    '-map',
    '[pcm]',
    '-ac',
    '1',
    '-ar',
    String(SPEECH_RATE),
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    out,
  ];
}

/** Silences from the reset meter clock onto the asset clock: shifted by the audio offset, clamped, pad included. */
export function silencesOnAssetClock(
  logged: readonly Silence[],
  offsetMs: number,
  durationMs: number,
): Silence[] {
  const clamp = (ms: number) => Math.min(durationMs, Math.max(0, ms));
  const moved = logged
    .map((s) => ({ startMs: clamp(s.startMs + offsetMs), endMs: clamp(s.endMs + offsetMs) }))
    .filter((s) => s.endMs > s.startMs);
  if (offsetMs > 0) moved.push({ startMs: 0, endMs: clamp(offsetMs) });
  return moved.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Runs the pass. A file without a sound stream is `audio.no_audio`; anything else FFmpeg refuses is its own
 * error. The WAV is left at `out` (the caller owns the folder and removes it).
 */
export async function runAudioPass(
  request: AudioPassRequest,
  ctx: MediaContext,
): AsyncResult<AudioPassResult> {
  const { path, plan, out, signal } = request;
  if (!plan.audio || plan.kind === 'image') return err(NoAudio({ name: path }));
  const kept: string[] = [];
  let partial = '';
  const onStderr = (chunk: Buffer) => {
    const lines = (partial + chunk.toString('utf8')).split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) if (KEEP.test(line)) kept.push(line);
  };
  const run = await runFfmpeg(ctx, audioPassArgs(path, plan, out), {
    // Audio only: no hardware video session, so a stop keeps SIGTERM then SIGKILL (IX3-K2).
    holdsVideoSession: false,
    onStderr,
    timeoutMs: TIMEOUT_FLOOR_MS + seconds(plan.duration) * TIMEOUT_PER_SECOND_MS,
    ...(signal ? { signal } : {}),
  });
  if (!run.ok) {
    if (reportsNoAudio(run.error.detail ?? ''))
      return err(NoAudio({ name: path }, { detail: run.error.detail }));
    return run;
  }
  if (KEEP.test(partial)) kept.push(partial);
  const log = kept.join('\n');
  const loudness = parseEbur128(log);
  if (!loudness) return err(NoAudio({ name: path }, { detail: 'ebur128 summary missing' }));
  const pcm = await readSpeechPcm(out);
  if (!pcm.ok) return pcm;
  const offsetMs = Math.round(seconds(plan.audio.offset) * 1000);
  const silences = silencesOnAssetClock(
    parseSilenceLog(log, Number.MAX_SAFE_INTEGER),
    offsetMs,
    pcm.value.durationMs,
  );
  return ok({ loudness, silences, pcm: pcm.value });
}
