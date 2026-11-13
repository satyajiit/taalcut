// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render's Phase 3 errors (SPEC P3.14). Params never hold paths. A missing subject track or mac helper is a
 * warning in the QA report, never an error.
 */
import { defineError } from '@taalcut/core';

/** A graphic's command asks what it can't do: an edit of a graphic without a composition, a use of no proposal. */
export const GraphicInvalid = defineError<{ kind: string; field: string }>('render.graphic_invalid');
/** A `.cube` file that isn't Adobe Cube LUT 1.0 as render reads it. */
export const CubeInvalid = defineError<{ reason: string }>('render.cube_invalid');
/** Applying a grade failed on both routes. */
export const GradeFailed = defineError('render.grade_failed', { retryable: true });
/** The Content Credentials component is missing or the sidecar failed: the export stops at signing. */
export const CredentialsUnavailable = defineError('render.credentials_unavailable', { retryable: true });
/** Signing produced a manifest that doesn't validate. */
export const CredentialsInvalid = defineError('render.credentials_invalid');
/** render.exportBatch with more items than a batch holds. */
export const BatchTooLarge = defineError<{ max: number }>('render.batch_too_large');
/** captions.applyTranslation must give every cue of the track exactly once. */
export const TranslationMismatch = defineError<{ missing: number; extra: number }>(
  'render.translation_mismatch',
);
