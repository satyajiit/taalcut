// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Style profiles' errors (LRN1-STY); each one's i18n key is `errors.<code>`. */
import { defineError } from '@taalcut/core';

/** The vision model answered with nothing to keep. */
export const StyleSummaryEmpty = defineError<{ model: string }>('templates.style_summary_empty', {
  retryable: true,
});
