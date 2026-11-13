// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Errors of library search (P2-L10). Each code's i18n key is `errors.<code>`. */
import { defineError } from '@taalcut/core';

/**
 * Vector search can't run: the embedding model isn't installed yet, or there is no vector index
 * yet. Search falls back to keywords (`degraded: 'keyword-only'`); find similar returns this.
 */
export const EmbedderUnavailable = defineError('library.embedder_unavailable', { retryable: true });
