// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineError } from '@taalcut/core';

/** The translation came back unusable (an empty unit, a cue over the command's length): trying again may work. */
export const TranslationFailed = defineError('audio.translation_failed', { retryable: true });

/** The translation's ids don't match what was sent: a unit missing, repeated or added. */
export const TranslationMismatch = defineError<{ unitId: string }>('audio.translation_mismatch');
