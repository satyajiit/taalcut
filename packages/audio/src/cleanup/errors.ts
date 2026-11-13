// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Talking-head cleanup errors (SPEC P3.12). */
import { defineError } from '@taalcut/core';

/** The asset has no transcript yet (indexing hasn't transcribed it): the analysis needs its words. */
export const NoTranscript = defineError<{ assetId: string }>('audio.no_transcript');
/** Silero VAD failed to load or run. */
export const VadFailed = defineError('audio.vad_failed', { retryable: true });
