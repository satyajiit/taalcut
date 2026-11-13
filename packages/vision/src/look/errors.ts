// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Look and grade errors (SPEC P3.5). Defined here so the parent lane can re-export them. */
import { defineError } from '@taalcut/core';

/** Nothing to measure: no frames, a bad buffer, or every frame was too dark. */
export const LookUnavailable = defineError('vision.look_unavailable');

/** The cube could not be baked. Trying again may succeed (a cache write, a restart). */
export const GradeFailed = defineError('vision.grade_failed', { retryable: true });
