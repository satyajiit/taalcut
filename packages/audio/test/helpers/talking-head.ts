// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A synthetic talking-head track for the cleanup tests: `say` phrases, fillers and silences of known lengths
 * joined at 16 kHz, and the transcript an engine would give (words spread over each phrase's voiced span; an
 * untranscribed part is left out of it, as Parakeet and whisper drop fillers).
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RationalTime, TimeRange, type Transcript, type TranscriptWord } from '@taalcut/core';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { decodeAudioFile } from '../../src/pcm/decode';
import { encodeFloatWav } from '../../src/pcm/pcm';
import { MILLISECONDS } from '../../src/rates';
import { sayToWav } from './speech';

export type Part =
  | {
      readonly say: string;
      readonly transcribed?: boolean;
      readonly rate?: number;
      /** Approximate voiced duration for threshold fixtures; `say` rate alone does not fix duration. */
      readonly targetVoicedMs?: number;
    }
  | { readonly silenceMs: number };

export interface BuiltClip {
  readonly path: string;
  readonly transcript: Transcript;
  /** Where each part landed, ms (voiced span for speech, the whole gap for silence). */
  readonly spans: readonly { readonly part: Part; readonly startMs: number; readonly endMs: number }[];
}

const RATE = 16_000;

function voicedSpan(samples: Float32Array): [number, number] {
  const hop = RATE / 100;
  let first = -1;
  let last = -1;
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < hop; j++) sum += (samples[i + j] ?? 0) ** 2;
    if (Math.sqrt(sum / hop) > 0.01) {
      if (first < 0) first = i;
      last = i + hop;
    }
  }
  return first < 0 ? [0, 0] : [first, last];
}

/** Keep the real voice and its pitch while moving a threshold fixture away from the detector's boundary. */
async function timedSpeech(
  media: MediaContext,
  wav: string,
  samples: Float32Array,
  targetMs: number,
): Promise<Float32Array> {
  const [from, to] = voicedSpan(samples);
  if (!Number.isFinite(targetMs) || targetMs <= 0 || to <= from)
    throw new Error('timed speech needs a positive target duration and audible speech');
  const tempo = ((to - from) * 1000) / (RATE * targetMs);
  const timed = wav.replace(/\.wav$/, '.timed.wav');
  const converted = await runFfmpeg(media, [
    '-nostdin',
    '-y',
    '-i',
    wav,
    '-af',
    `atempo=${tempo}`,
    '-c:a',
    'pcm_s16le',
    timed,
  ]);
  if (!converted.ok) throw new Error(`timed speech failed: ${converted.error.detail ?? ''}`);
  const decoded = await decodeAudioFile(timed, media, { sampleRate: RATE, channels: 1 });
  if (!decoded.ok) throw new Error('timed speech could not be decoded');
  return decoded.value.channels[0] ?? new Float32Array();
}

/** The clip from each spoken part's 16 kHz mono samples (silences are made here): samples, transcript, spans. */
export function assembleTalkingHead(
  parts: readonly Part[],
  speech: (part: Extract<Part, { say: string }>, index: number) => Float32Array,
): { readonly samples: Float32Array; readonly transcript: Transcript; readonly spans: BuiltClip['spans'] } {
  const chunks: Float32Array[] = [];
  const words: TranscriptWord[] = [];
  const spans: { part: Part; startMs: number; endMs: number }[] = [];
  let at = 0;
  for (const [index, part] of parts.entries()) {
    if ('silenceMs' in part) {
      const n = Math.round((part.silenceMs * RATE) / 1000);
      chunks.push(new Float32Array(n));
      spans.push({ part, startMs: (at * 1000) / RATE, endMs: ((at + n) * 1000) / RATE });
      at += n;
      continue;
    }
    const samples = speech(part, index);
    const [from, to] = voicedSpan(samples);
    const startMs = ((at + from) * 1000) / RATE;
    const endMs = ((at + to) * 1000) / RATE;
    spans.push({ part, startMs, endMs });
    if (part.transcribed !== false) words.push(...spreadWords(part.say, startMs, endMs));
    chunks.push(samples);
    at += samples.length;
  }
  const joined = new Float32Array(at);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const transcript: Transcript = {
    version: 1,
    language: 'en',
    engine: 'parakeet',
    model: 'test',
    local: true,
    wordTiming: 'native',
    segments: [
      {
        text: words.map((w) => w.text).join(' '),
        range: TimeRange.of(
          RationalTime.of(0, MILLISECONDS),
          RationalTime.of(Math.round((at * 1000) / RATE), MILLISECONDS),
        ),
        words,
        language: 'en',
      },
    ],
  };
  return { samples: joined, transcript, spans };
}

/** A phrase's words spread over its voiced span by length, as an engine's word timings would roughly be. */
function spreadWords(text: string, startMs: number, endMs: number): TranscriptWord[] {
  const tokens = text.split(' ');
  const total = tokens.reduce((n, t) => n + t.length + 1, 0);
  const words: TranscriptWord[] = [];
  let cursor = startMs;
  for (const token of tokens) {
    const length = ((endMs - startMs) * (token.length + 1)) / total;
    words.push({
      text: token,
      range: TimeRange.of(
        RationalTime.of(Math.round(cursor), MILLISECONDS),
        RationalTime.of(Math.max(1, Math.round(length - 10)), MILLISECONDS),
      ),
      confidence: 0.9,
    });
    cursor += length;
  }
  return words;
}

export async function buildTalkingHead(
  media: MediaContext,
  dir: string,
  parts: readonly Part[],
): Promise<BuiltClip> {
  const speech = new Map<number, Float32Array>();
  for (const [index, part] of parts.entries()) {
    if ('silenceMs' in part) continue;
    const wav = await sayToWav(media, dir, `part-${index}`, part.say, {
      sampleRate: RATE,
      ...(part.rate ? { rate: part.rate } : {}),
    });
    const pcm = await decodeAudioFile(wav, media, { sampleRate: RATE, channels: 1 });
    if (!pcm.ok) throw new Error(`decode ${index}`);
    const samples = pcm.value.channels[0] ?? new Float32Array();
    speech.set(
      index,
      part.targetVoicedMs === undefined
        ? samples
        : await timedSpeech(media, wav, samples, part.targetVoicedMs),
    );
  }
  const clip = assembleTalkingHead(parts, (_, index) => speech.get(index) ?? new Float32Array());
  const path = join(dir, 'talking-head.wav');
  await writeFile(path, encodeFloatWav({ sampleRate: RATE, channels: [clip.samples] }));
  return { path, transcript: clip.transcript, spans: clip.spans };
}
