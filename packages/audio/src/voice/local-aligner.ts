// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Local ASR word-alignment bridge for on-device TTS (WP-VO-LOCAL): writes generated
 * PCM16 WAV bytes to a temporary file, transcribes them with a local `SpeechEngine`
 * (Parakeet TDT on ANE, Sherpa, or Whisper.cpp on Metal), and returns word timings
 * in seconds for character-level caption & beat alignment.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type AsyncResult, type Transcript } from '@taalcut/core';
import { rangeToMs } from '../rates';
import type { SpeechEngine } from '../speech/engine';

export interface AlignedTranscriptWord {
  readonly word: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface SpeechWordAlignerDeps {
  readonly engine: SpeechEngine;
  readonly scratchDir?: string;
}

export interface SpeechWordAligner {
  alignWords(request: {
    readonly wavBytes: Uint8Array;
    readonly text: string;
    readonly language: string;
    readonly signal?: AbortSignal;
  }): AsyncResult<readonly AlignedTranscriptWord[]>;
}

/** Extracts word start/end timings in seconds from a `Transcript`. */
export function wordsFromTranscript(transcript: Transcript): readonly AlignedTranscriptWord[] {
  const words: AlignedTranscriptWord[] = [];
  for (const segment of transcript.segments) {
    for (const word of segment.words) {
      const trimmed = word.text.trim();
      if (!trimmed) continue;
      const { startMs, endMs } = rangeToMs(word.range);
      words.push({
        word: trimmed,
        startSeconds: Math.round(startMs) / 1000,
        endSeconds: Math.round(Math.max(startMs, endMs)) / 1000,
      });
    }
  }
  return words;
}

export function createSpeechWordAligner(deps: SpeechWordAlignerDeps): SpeechWordAligner {
  const baseDir = deps.scratchDir ?? tmpdir();

  return {
    async alignWords(request): AsyncResult<readonly AlignedTranscriptWord[]> {
      const dir = await mkdtemp(join(baseDir, 'taalcut-tts-align-'));
      const wavPath = join(dir, 'line.wav');
      try {
        await writeFile(wavPath, request.wavBytes);
        const transcribed = await deps.engine.transcribe(wavPath, {
          language: request.language,
          ...(request.signal ? { signal: request.signal } : {}),
        });
        if (!transcribed.ok) return transcribed;
        return ok(wordsFromTranscript(transcribed.value));
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}
