// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Caption translation errors (SPEC P3.4, P3.7). */
import { defineError } from '@taalcut/core';

/** The model's answer broke the rules twice: ids missing or added, markup, or far longer than the source. */
export const TranslationInvalid = defineError<{ problem: string }>('models.translation_invalid', {
  retryable: true,
});
