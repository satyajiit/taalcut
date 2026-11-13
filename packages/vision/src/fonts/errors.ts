// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Font-match failures. Declared here so the package error module can re-export them. */
import { defineError } from '@taalcut/core';

/**
 * The crop is too short, OCR is below the bar, or the string has no script.
 * A misread string makes every candidate equally wrong, so this is not a guess.
 */
export const FontMatchWithheld = defineError<{ ocrConfidence: number }>('vision.font_match_withheld');

/** A bundled file is missing or unreadable, or the text renderer failed. Trying again may work. */
export const FontRenderFailed = defineError('vision.font_render_failed', { retryable: true });
