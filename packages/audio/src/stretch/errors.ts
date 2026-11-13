// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Time-stretch errors (SPEC P3.12). */
import { defineError } from '@taalcut/core';

/** No Signalsmith module and a ratio outside atempo's 0.90–1.10. */
export const StretchUnavailable = defineError<{ ratio: number }>('audio.stretch_unavailable');
/** The stretcher itself failed (a bad segment list is a caller bug, reported here with its detail). */
export const StretchFailed = defineError('audio.stretch_failed', { retryable: true });
