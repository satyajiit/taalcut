// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template search by meaning (LRN1-TPL): `template_fts`'s words ranked by bm25, the template index's document
 * vectors and its slot-intent vectors, fused into one ranking. The library implements it over its database, the
 * template index (TemplateIndexToken) and core's Embedder; @taalcut/templates serves it to the agent as
 * `templates.search`. Without an embedding space (the model isn't installed yet) it ranks by words alone and says so,
 * as library search does. Its schemas are in templates-contract.ts, beside the `templates.search` IPC route.
 */
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { TemplateSearchQuery, TemplateSearchResult } from './templates-contract';

export interface TemplateSearch {
  search(query: TemplateSearchQuery, signal?: AbortSignal): AsyncResult<TemplateSearchResult>;
}

export const TemplateSearchToken = createToken<TemplateSearch>('core.templateSearch');
