// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio errors. An empty transcript and a skipped cloud call are results,
 * not errors: the caller asked and the answer is "nothing to say".
 */
import { defineError } from '@taalcut/core';

export const NoAudio = defineError<{ name: string }>('audio.no_audio');
export const EngineUnavailable = defineError<{ engine: string }>('audio.engine_unavailable');
export const ModelMissing = defineError<{ component: string }>('audio.model_missing');
export const LanguageDetectFailed = defineError('audio.language_detect_failed', { retryable: true });
export const TranscriptionFailed = defineError('audio.transcription_failed', { retryable: true });
export const BeatTrackingFailed = defineError('audio.beat_tracking_failed', { retryable: true });
/** A scratch or output file couldn't be written (a full disk, a folder gone). */
export const AudioWriteFailed = defineError('audio.write_failed', { retryable: true });
/** A provider call for a voice line, a track or a sound failed (retryable; provider errors pass through as models'). */
export const GenerationFailed = defineError('audio.generation_failed', { retryable: true });
/** The generation port can't run now (SPEC P3.12; core's GENERATION_UNAVAILABLE_REASONS). */
export const GenerationUnavailable = defineError<{ reason: string }>('audio.voice_unavailable');
