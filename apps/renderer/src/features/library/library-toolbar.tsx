// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: library search and filters · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * one wide search field (natural language), then a row of filter pills and the sort, left; the count, right
 * states: field default · hover · focus (base ring) · typing (clear button) · searching (spinner in the field)
 *   · error (the results say so) · disabled n/a; the count: counting (a still bone of its width) · known (tabular
 *   figures); pills: filter-pill.tsx; Clear filters is a ghost Button (eight states)
 * LIB1-FIND · mode: Operate · system: DESIGN.md v0.7: after When, a Trip pill (place's trips, newest first; a name
 *   the person gave is raw), a Place pill (countries by clips, each with its cities one level in, raw: the dataset's
 *   names; coordinates only, never a time-zone guess) and an Activity pill (what people in the clips are doing, most
 *   clips first; a free action is the model's words, raw)
 *   layout (audit L1): every pill is in the row from the first frame, whatever the library holds; the reads only fill
 *   their menus, so nothing moves when they land. A pill the library has nothing for stays and says how it fills
 *   (filter-pill.tsx `empty`); Source shows with one source too (it names where the clips came from)
 */
import type { MessageDescriptor } from '@lingui/core';
import { Plural, useLingui } from '@lingui/react/macro';
import type { SourceView } from '@taalcut/core';
import { Button, cn, isEditableTarget, VERB_ICONS } from '@taalcut/ui';
import { ArrowDownWideNarrow, LoaderCircle, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { LENGTH_LABELS, PERIOD_LABELS, QUALITY_LABELS, SHAPE_LABELS, SORT_LABELS } from './filters';
import { FilterPill } from './filter-pill';
import {
  hasFilters,
  LENGTHS,
  NO_FILTERS,
  PERIODS,
  QUALITIES,
  SHAPES,
  type LibrarySearch,
} from './library-search';
import { placeChoices, tripChoices } from './place-choices';
import { actionWords } from './shot-action-labels';
import { useLibraryPlaces } from './use-library-places';
import { useShotActions } from './use-shot-actions';

/** How long typing pauses before the search runs. */
const SETTLE_MS = 300;

type SortChoice = 'captured' | 'oldest' | 'added' | 'duration' | 'quality';

export interface LibraryToolbarProps {
  search: LibrarySearch;
  onChange: (next: Partial<LibrarySearch>) => void;
  sources: readonly SourceView[];
  /** Clips that match the filters; null while counting. */
  count: number | null;
  searching: boolean;
}

export function LibraryToolbar({ search, onChange, sources, count, searching }: LibraryToolbarProps) {
  const { t, i18n } = useLingui();
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(search.q ?? '');

  // The URL is the truth: Back, a link or Clear puts its words in the field.
  useEffect(() => setText(search.q ?? ''), [search.q]);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === (search.q ?? '')) return;
    const timer = setTimeout(() => onChange({ q: trimmed || undefined }), SETTLE_MS);
    return () => clearTimeout(timer);
    // onChange is a new function each render; the words are what matter.
  }, [text, search.q]);

  // ⌘F puts the cursor in the search field, as in Finder and Photos.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'f' &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sort: SortChoice =
    search.sort === 'captured' && search.dir === 'asc' ? 'oldest' : (search.sort ?? 'captured');
  const options = <V extends string>(values: readonly V[], words: Readonly<Record<V, MessageDescriptor>>) =>
    values.map((value) => ({ value, label: i18n._(words[value]) }));
  // What people in the clips are doing, most clips first; a chosen one stays offered while no clip shows it.
  const counted = useShotActions();
  const shown = counted ?? [];
  const actionChoices = [
    ...shown.map((count) => count.action),
    ...(search.action && !shown.some((count) => count.action === search.action) ? [search.action] : []),
  ].map((action) => ({ value: action, ...actionWords(i18n, action) }));
  // Where the clips were filmed and the trips they make (place's reads); a guess from a time zone is never a place.
  // Until a read answers, a chosen trip or place isn't "another" one: it is only not named yet.
  const placed = useLibraryPlaces();
  const trips = tripChoices(i18n, placed.trips ?? [], placed.trips ? search.trip : undefined);
  // One pill for both: a country's value is its code, a city's its id.
  const place = search.city !== undefined ? String(search.city) : search.country;
  const places = placeChoices(i18n, placed.places ?? [], placed.places ? place : undefined);

  return (
    <div className="flex flex-col gap-3" data-slot="library-toolbar">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onChange({ q: text.trim() || undefined });
        }}
        className="relative"
      >
        <label htmlFor={fieldId} className="sr-only">
          {t`Search your clips`}
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3"
        />
        <input
          ref={field}
          id={fieldId}
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && text) {
              event.preventDefault();
              setText('');
              onChange({ q: undefined });
            }
          }}
          placeholder={t`Describe a shot, or something said in it`}
          className={cn(
            'h-11 w-full rounded-lg border border-rule-strong bg-raised ps-10 pe-11 text-md text-ink placeholder:text-ink-3',
            'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:border-ink-3',
            '[&::-webkit-search-cancel-button]:appearance-none',
          )}
        />
        <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
          {searching ? (
            <LoaderCircle aria-hidden className="m-2 size-4 animate-spin text-ink-3" />
          ) : text ? (
            <button
              type="button"
              onClick={() => {
                setText('');
                onChange({ q: undefined });
                field.current?.focus();
              }}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink active:bg-pressed"
            >
              <X aria-hidden className="size-4" />
              <span className="sr-only">{t`Clear search`}</span>
            </button>
          ) : null}
        </span>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <FilterPill
          label={t`Shape`}
          value={search.shape}
          options={options(SHAPES, SHAPE_LABELS)}
          onChange={(shape) => onChange({ shape })}
        />
        <FilterPill
          label={t`Length`}
          value={search.length}
          options={options(LENGTHS, LENGTH_LABELS)}
          onChange={(length) => onChange({ length })}
        />
        <FilterPill
          label={t`Quality`}
          value={search.quality}
          options={options(QUALITIES, QUALITY_LABELS)}
          onChange={(quality) => onChange({ quality })}
        />
        <FilterPill
          label={t`When`}
          value={search.when}
          options={options(PERIODS, PERIOD_LABELS)}
          onChange={(when) => onChange({ when })}
        />
        {/* These four fill from the library's reads but are here from the first frame (audit L1). An empty menu
            explains itself once the library has said it has nothing, never while it is still being asked. */}
        <FilterPill
          label={t`Trip`}
          value={search.trip}
          options={trips}
          onChange={(trip) => onChange({ trip: trip as LibrarySearch['trip'] })}
          empty={placed.trips ? t`No trips yet. A few clips filmed away from home make one.` : undefined}
        />
        <FilterPill
          label={t`Place`}
          value={place}
          options={places}
          onChange={(chosen) =>
            onChange(
              chosen && /^\d+$/.test(chosen)
                ? { city: Number(chosen), country: undefined }
                : { country: chosen, city: undefined },
            )
          }
          empty={
            placed.places
              ? t`No places yet. A clip gets one from the location its phone or camera saved.`
              : undefined
          }
        />
        <FilterPill
          label={t`Activity`}
          value={search.action}
          options={actionChoices}
          onChange={(action) => onChange({ action })}
          empty={
            counted
              ? t`Nothing yet. What people are doing shows up as Taalcut describes your clips.`
              : undefined
          }
        />
        <FilterPill
          label={t`Source`}
          value={search.source}
          options={sources.map((source) => ({ value: source.id, label: source.name, raw: true }))}
          onChange={(source) => onChange({ source })}
        />
        {hasFilters(search) ? (
          <Button
            variant="ghost"
            size="sm"
            icon={VERB_ICONS.clearFilters}
            onClick={() => onChange(NO_FILTERS)}
          >
            {t`Clear filters`}
          </Button>
        ) : null}
        <span className="ms-auto flex items-center gap-3">
          {!search.q && !search.similar ? (
            // The count arrives after the toolbar: until then a still bone holds its place at about its size, so
            // nothing in the row moves when the number lands. The live region is there from the start, so the
            // number is announced when it comes.
            <span
              role="status"
              aria-busy={count === null}
              data-slot="clip-count"
              className="flex h-5 items-center text-sm text-ink-2 tabular-nums"
            >
              {count === null ? (
                <span aria-hidden className="tc-bone inline-block h-4 w-17 rounded-sm bg-hover" />
              ) : (
                <Plural value={count} one="# clip" other="# clips" />
              )}
            </span>
          ) : null}
          {!search.q && !search.similar ? (
            <FilterPill
              label={t`Sort`}
              clearable={false}
              icon={<ArrowDownWideNarrow aria-hidden />}
              value={sort}
              options={[
                { value: 'captured', label: i18n._(SORT_LABELS.captured) },
                { value: 'oldest', label: t`Oldest first` },
                { value: 'added', label: i18n._(SORT_LABELS.added) },
                { value: 'duration', label: i18n._(SORT_LABELS.duration) },
                { value: 'quality', label: i18n._(SORT_LABELS.quality) },
              ]}
              onChange={(choice) =>
                onChange(
                  choice === 'oldest'
                    ? { sort: 'captured', dir: 'asc' }
                    : { sort: choice === 'captured' ? undefined : choice, dir: undefined },
                )
              }
            />
          ) : null}
        </span>
      </div>
    </div>
  );
}
