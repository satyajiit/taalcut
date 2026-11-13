// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: template library search, filters and sort · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * one search field (⌘F), then one row of filter pills (tags, format, language, length, trend), Clear filters when
 *   any is set, and the sort pill at the row's end. The same idiom as the Library and the hub; the row fits one line
 *   at 1280 in English (UX1 M10, M11) and wraps with the sort kept to the right below that. While the field has
 *   words the list is the search's answer, best match first, so the sort pill steps aside as the Library's does
 *   (LRN1-FIX); the URL keeps the sort for when the words go
 * states: the field's (search-field.tsx); the pills' (filter-pill.tsx, tag-filter.tsx, trend-pill.tsx,
 *   sort-pill.tsx); Clear filters is a ghost Button (eight states)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
import type { MessageDescriptor } from '@lingui/core';
import { Plural, useLingui } from '@lingui/react/macro';
import type { TemplateSort } from '@taalcut/core';
import { Button, VERB_ICONS } from '@taalcut/ui';
import { FilterPill } from '../../library/filter-pill';
import { formatLanguage } from '../../shared/format';
import { SearchField } from '../search-field';
import { FORMAT_NAMES } from '../template-words';
import { LENGTH_LABELS, SORT_DIRECTION_WORDS, SORT_LABELS } from './library-words';
import { SortPill } from './sort-pill';
import { TagFilter } from './tag-filter';
import {
  CLEARED,
  hasFilters,
  sortOf,
  tagsOf,
  TEMPLATE_LENGTHS,
  TEMPLATE_SORT_CHOICES,
  type TemplateSearch,
} from './template-search';
import { TrendPill } from './trend-pill';
import type { LibraryFacets } from './use-template-library';

export interface LibraryToolbarProps {
  readonly search: TemplateSearch;
  readonly onChange: (next: Partial<TemplateSearch>) => void;
  /** The field's words as typed (the list follows them at once; the URL a moment later). */
  readonly text: string;
  readonly onText: (text: string) => void;
  readonly facets: LibraryFacets | undefined;
  /** How many the list holds now: read out when it changes. */
  readonly count?: number | undefined;
}

export function LibraryToolbar({ search, onChange, text, onText, facets, count }: LibraryToolbarProps) {
  const { t, i18n } = useLingui();
  const words = <V extends string>(values: readonly V[], labels: Readonly<Record<V, MessageDescriptor>>) =>
    values.map((value) => ({ value, label: i18n._(labels[value]) }));
  const { sort, dir } = sortOf(search);
  const formats = facets?.formats ?? [];
  const languages = facets?.languages ?? [];
  const order = SORT_DIRECTION_WORDS[sort];

  return (
    <div className="flex flex-col gap-3" data-slot="templates-toolbar">
      <SearchField
        label={t`Search your templates`}
        placeholder={t`Find a template by name, tag or shot`}
        value={text}
        onChange={onText}
        onSubmit={() => onChange({ q: text.trim() || undefined })}
        findShortcut
      />
      <div className="flex flex-wrap items-center gap-2" data-slot="templates-filters">
        <TagFilter
          value={tagsOf(search)}
          tags={facets?.tags ?? []}
          onChange={(tags) => onChange({ tags: tags.join(',') || undefined })}
        />
        <FilterPill
          label={t`Format`}
          value={search.format}
          disabled={formats.length === 0 && !search.format}
          options={formats.map((format) => ({ value: format, label: i18n._(FORMAT_NAMES[format]) }))}
          onChange={(format) => onChange({ format })}
        />
        <FilterPill
          label={t`Language`}
          value={search.lang}
          disabled={languages.length === 0 && !search.lang}
          options={(search.lang && !languages.includes(search.lang)
            ? [search.lang, ...languages]
            : languages
          ).map((lang) => ({ value: lang, label: formatLanguage(i18n, lang) }))}
          onChange={(lang) => onChange({ lang })}
        />
        <FilterPill
          label={t`Length`}
          value={search.length}
          options={words(TEMPLATE_LENGTHS, LENGTH_LABELS)}
          onChange={(length) => onChange({ length })}
        />
        <TrendPill stale={search.stale === true} onChange={(stale) => onChange({ stale })} />
        {hasFilters(search) ? (
          <Button size="sm" variant="ghost" icon={VERB_ICONS.clearFilters} onClick={() => onChange(CLEARED)}>
            {t`Clear filters`}
          </Button>
        ) : null}
        {/* The count is read out as it changes; on screen the places' counts and the rows say it, so the row of
            filters keeps one line at 1280. */}
        <span data-slot="templates-count" aria-live="polite" className="sr-only">
          {count === undefined ? null : <Plural value={count} one="# template" other="# templates" />}
        </span>
        {text.trim() ? null : (
          <span className="ms-auto">
            <SortPill<TemplateSort>
              value={sort}
              options={words(TEMPLATE_SORT_CHOICES, SORT_LABELS)}
              // A new sort starts in its own direction: names A to Z, the rest newest or most first.
              onChange={(next) => onChange({ sort: next === 'updated' ? undefined : next, dir: undefined })}
              direction={{
                value: dir,
                words: { asc: i18n._(order.asc), desc: i18n._(order.desc) },
                onChange: (next) => onChange({ dir: next }),
              }}
            />
          </span>
        )}
      </div>
    </div>
  );
}
