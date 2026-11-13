// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { TemplateId } from '@taalcut/core';
import { TemplateSearchPanel } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import type { SearchSuggestions } from './search-suggestions';
import type { TemplateSearchState } from './search-view';

/** The Templates page's search as its field's suggestions: the answer's first results, and opening the chosen one. */
export function useSearchSuggestions(state: TemplateSearchState): SearchSuggestions {
  const navigate = useNavigate();
  const open = useCallback(
    (templateId: TemplateId) => void navigate({ to: '/templates/$templateId', params: { templateId } }),
    [navigate],
  );
  const { view, hits, retry } = state;
  return useMemo(
    () => ({
      count: hits.length,
      choose: (index: number) => {
        const hit = hits[index];
        if (hit) open(hit.summary.id);
      },
      panel: (props) => <TemplateSearchPanel view={view} onOpen={open} onRetry={retry} {...props} />,
    }),
    [view, hits, retry, open],
  );
}
