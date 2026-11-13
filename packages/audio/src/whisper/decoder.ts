// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How whisper.cpp is run, behind one port (IX-A3): a process per call (`whisper-cli`, the model loaded every
 * time) or a persistent server per model (`whisper-server`, loaded once). Both take a 16 kHz mono WAV and give
 * back whisper's tokens with their times, so the transcript (words, loops, segments) is built the same way from
 * either; both pass whisper the same decoding settings (beam 5, best of 5, whisper's defaults otherwise).
 */
import { basename } from 'node:path';
import type { AsyncResult } from '@taalcut/core';
import { AUDIO_CONFIG } from '../config';
import { whisperCodeFor } from '../speech/whisper-languages';
import type { WhisperToken } from '../speech/whisper-parse';

/** whisper's `-l`: one of its languages (whisper-languages.ts) or `auto`. Never left out: the CLI's default is English. */
export type WhisperLanguageFlag = string;

export interface WhisperTranscribeRequest {
  /** A 16 kHz mono WAV. */
  readonly audio: string;
  /** A ggml model file. */
  readonly model: string;
  readonly language: WhisperLanguageFlag;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}

export interface WhisperDecoded {
  readonly tokens: readonly WhisperToken[];
  /** The language whisper transcribed: the one asked for, or what it detected for `auto`. */
  readonly language: string | null;
}

export interface WhisperLanguageRequest {
  readonly audio: string;
  readonly model: string;
  readonly signal?: AbortSignal;
}

export interface WhisperLanguageGuess {
  readonly language: string;
  /** whisper's probability for it; the language decision applies the floor (LIB1-LANG). */
  readonly probability: number;
  /** The likeliest languages with theirs, most likely first; the server gives it, the CLI only the top. */
  readonly distribution?: readonly { readonly language: string; readonly probability: number }[];
}

export interface WhisperDecoder {
  readonly mode: 'process-per-call' | 'persistent';
  transcribe(request: WhisperTranscribeRequest): AsyncResult<WhisperDecoded>;
  identifyLanguage(request: WhisperLanguageRequest): AsyncResult<WhisperLanguageGuess>;
}

/** The flag for a BCP 47 tag: Whisper's code for it, `auto` for a language Whisper doesn't know or none. */
export function whisperLanguageFlag(language: string | undefined): WhisperLanguageFlag {
  if (!language || language === 'auto') return 'auto';
  return whisperCodeFor(language) ?? 'auto';
}

/** DTW is the small q8 model only. Medium's DTW was worse, so it stays off (SPEC, Transcripts and word timings). */
export function usesSmallDtw(modelPath: string): boolean {
  const name = basename(modelPath).toLowerCase();
  if (name.includes('medium') || name.includes('tiny')) return false;
  return modelPath.toLowerCase().includes('small');
}

export function whisperModelId(modelPath: string): string {
  const name = basename(modelPath).toLowerCase();
  if (name.includes('tiny')) return 'whisper-tiny';
  if (name.includes('medium')) return AUDIO_CONFIG.models.whisperMedium;
  if (name.includes('small')) return AUDIO_CONFIG.models.whisperSmall;
  return basename(modelPath);
}

export function whisperComponent(modelPath: string): string {
  const name = basename(modelPath).toLowerCase();
  if (name.includes('tiny')) return 'whisper-tiny';
  if (name.includes('medium')) return 'whisper-medium-q5-0';
  if (name.includes('small')) return 'whisper-small-q8-0';
  return 'whisper-cpp';
}

/** Beam search, as whisper-cli runs by default; the server must be told (its default is greedy). */
export const WHISPER_BEAM = { beamSize: 5, bestOf: 5 } as const;
