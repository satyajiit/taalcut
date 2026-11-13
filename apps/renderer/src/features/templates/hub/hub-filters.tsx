// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: hub filters (/templates/hub) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the same idiom as the Library and Templates (UX1 M11): the search field, then one row
 *   of filter pills (language, format, length, tags: the most common in what is listed, with any already picked),
 *   Clear filters when anything narrows the list, and the sort pill at the row's end. Everything lives in the URL.
 * states: the field's (search-field.tsx); the pills' (filter-pill.tsx, tag-filter.tsx, sort-pill.tsx); Clear
 *   filters is a ghost Button (eight states); loading, error and success are the list's
 */
import { useLingui } from '@lingui/react/macro';
import { FORMAT_IDS, type HubSort } from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { Globe, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FilterPill } from '../../library/filter-pill';
import { formatLanguage, formatSeconds } from '../../shared/format';
import { SortPill } from '../library/sort-pill';
import { TagFilter } from '../library/tag-filter';
import { SearchField } from '../search-field';
import { HUB_LENGTHS, isFiltered, tagsOf, type HubSearch } from './hub-search';
import { HUB_FORMAT_NAMES, HUB_LANGUAGES, SORT_NAMES } from './hub-words';

const SORTS: readonly HubSort[] = ['topRated', 'newest', 'freshest'];
/** The hub takes at most this many tags in one search. */
const MAX_TAGS = 8;
/** Typing settles for a moment before the URL (and the list) follow. */
const SETTLE_MS = 250;

export interface HubFiltersProps {
  readonly search: HubSearch;
  onSearch(next: HubSearch): void;
  /** The tags worth offering: the most common in what is listed, with any already picked. */
  readonly tags: readonly string[];
}

export function HubFilters({ search, onSearch, tags }: HubFiltersProps) {
  const { t, i18n } = useLingui();
  const [text, setText] = useState(search.q ?? '');
  const picked = tagsOf(search);

  useEffect(() => {
    const query = text.trim();
    if (query === (search.q ?? '')) return;
    const timer = setTimeout(() => onSearch({ ...search, q: query || undefined }), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [text, search, onSearch]);
  useEffect(() => setText(search.q ?? ''), [search.q]);

  const lengths = HUB_LENGTHS.map((length) => {
    const most = formatSeconds(i18n, length);
    return { value: String(length), label: t`Up to ${most}` };
  });

  return (
    <div data-slot="hub-filters" className="flex flex-col gap-3">
      <SearchField
        label={t`Find in the hub`}
        placeholder={t`Find in the hub by name, tag or handle`}
        value={text}
        onChange={setText}
        onSubmit={() => onSearch({ ...search, q: text.trim() || undefined })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill
          label={t`Language`}
          icon={<Globe aria-hidden />}
          value={search.lang}
          options={HUB_LANGUAGES.map((tag) => ({ value: tag, label: formatLanguage(i18n, tag) }))}
          onChange={(lang) => onSearch({ ...search, lang })}
        />
        <FilterPill
          label={t`Format`}
          value={search.format}
          options={FORMAT_IDS.map((id) => ({ value: id, label: i18n._(HUB_FORMAT_NAMES[id]) }))}
          onChange={(format) => onSearch({ ...search, format })}
        />
        <FilterPill
          label={t`Length`}
          value={search.max ? String(search.max) : undefined}
          options={lengths}
          onChange={(max) =>
            onSearch({ ...search, max: HUB_LENGTHS.find((length) => String(length) === max) })
          }
        />
        <TagFilter
          value={picked}
          tags={tags}
          prefix="#"
          onChange={(next) =>
            onSearch({ ...search, tags: next.length > 0 ? next.slice(0, MAX_TAGS).join(',') : undefined })
          }
        />
        {isFiltered(search) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setText('');
              onSearch({ ...(search.sort ? { sort: search.sort } : {}) });
            }}
          >
            <X aria-hidden />
            {t`Clear filters`}
          </Button>
        ) : null}
        <span className="ms-auto">
          <SortPill<HubSort>
            value={search.sort ?? 'topRated'}
            options={SORTS.map((sort) => ({ value: sort, label: i18n._(SORT_NAMES[sort]) }))}
            onChange={(sort) => onSearch({ ...search, sort: sort === 'topRated' ? undefined : sort })}
          />
        </span>
      </div>
    </div>
  );
}
