// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Ducking errors (SPEC P3.12). */
import { defineError } from '@taalcut/core';

/** Even at the floor the voice can't stay `marginLu` above the music (a skill's verify reports it). */
export const DuckingUnmet = defineError<{ minMarginLu: number }>('audio.ducking_unmet');
/** A stem couldn't be metered (FFmpeg's ebur128 failed or wrote nothing). */
export const LoudnessFailed = defineError('audio.loudness_failed', { retryable: true });
