// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the library, searched in plain words · mode: Operate · system: WEB2 Remix Vernacular
 * rebuilt lean from the app's clip grid (apps/renderer/src/features/library/clip-grid, asset-tile, day-heading):
 *   the camera roll by day (the owner's footage from a trip to Vietnam), each day's heading in words with its count,
 *   each clip's frame at 9:16 with its length on the frame and what it shows under it. Above
 *   it, the search field and three words to try. A search keeps the clips that match and says how many, in words
 * states: field default · hover (the edge to ink-3) · focus (base ring) · filled (Clear search shows) · results
 *   (the count, said politely) · empty (the words and Clear search) · suggestion buttons: default, hover, focus,
 *   active, chosen (aria-pressed) · disabled/loading/error n/a (searched in the page)
 * motion: clips that leave fade, the rest close up by transform (layout); reduced motion: the fade alone */

import { AnimatePresence, motion } from 'motion/react';
import { useId, useState } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { SHOWCASE_ICONS } from '../icons';
import { ClipFrame } from '../frame';
import { undatedDayHeading } from '#content/reels';
import { byDay, clipLength, dayWords, matchClips, SEARCH_SUGGESTIONS, type RollClip } from './roll';

export function LibrarySearch({
  clips,
  compact = false,
}: {
  readonly clips: readonly RollClip[];
  readonly compact?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const found = matchClips(clips, query);
  const days = byDay(found);
  const words = query.trim();
  const Search = SHOWCASE_ICONS.search;
  const Clear = SHOWCASE_ICONS.close;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-q`} className="type-label text-ink">
          Search your clips
        </label>
        <div className="relative max-w-lg">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
          />
          <input
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try “night” or “lanterns on the street”"
            autoComplete="off"
            aria-describedby={`${id}-count`}
            className={cn(
              'h-10 w-full rounded-pill border border-rule-strong bg-raised ps-9 pe-10 type-body text-ink placeholder:text-ink-3',
              'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:border-ink-3 focus:border-ink-2 focus:bg-canvas',
              '[&::-webkit-search-cancel-button]:appearance-none',
            )}
          />
          {words ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1 inline-grid size-8 -translate-y-1/2 place-items-center rounded-pill text-ink-2 hover:bg-hover hover:text-ink active:bg-pressed"
            >
              <Clear aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="type-meta text-ink-2">Try</span>
          {SEARCH_SUGGESTIONS.map((word) => (
            <button
              key={word}
              type="button"
              aria-pressed={words.toLowerCase() === word}
              onClick={() => setQuery(words.toLowerCase() === word ? '' : word)}
              className={cn(
                'inline-flex h-8 items-center rounded-pill border px-3 type-label-sm transition-colors duration-(--dur-micro) ease-(--ease-out) active:bg-pressed',
                words.toLowerCase() === word
                  ? 'border-teal-strong bg-teal-soft text-ink'
                  : 'border-rule bg-control text-ink-2 hover:bg-control-hover hover:text-ink',
              )}
            >
              <Search aria-hidden className="me-1.5 size-3.5 text-ink-3" />
              {word}
            </button>
          ))}
        </div>
      </div>

      <p id={`${id}-count`} role="status" className="m-0 type-body text-ink-2">
        {words ? (
          found.length === 0 ? (
            <>No clips match “{words}”. Try night, street or trees.</>
          ) : (
            <>
              {found.length} of {clips.length} clips match “{words}”.
            </>
          )
        ) : (
          <>
            <span className="text-ink">{clips.length} clips</span> from a trip to Vietnam.
          </>
        )}
      </p>

      <div className={cn('flex flex-col gap-5', compact ? 'min-h-40' : 'min-h-64')}>
        <AnimatePresence initial={false} mode="popLayout">
          {days.map(({ day, clips: list }) => (
            <motion.section
              key={day}
              layout="position"
              aria-labelledby={`${id}-${day}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DUR.short, ease: EASE_OUT }}
              className="flex flex-col gap-2"
            >
              <div className="flex items-end gap-3">
                <h4 id={`${id}-${day}`} className="m-0 type-card-title text-ink">
                  {undatedDayHeading(day) ?? <time dateTime={day}>{dayWords(day)}</time>}
                </h4>
                <span className="pb-px type-meta text-ink-2 tabular-nums">
                  {list.length} {list.length === 1 ? 'clip' : 'clips'}
                </span>
              </div>
              <ul
                className={cn(
                  'm-0 grid list-none gap-2 p-0',
                  compact
                    ? 'grid-cols-[repeat(auto-fill,minmax(4rem,1fr))]'
                    : 'grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))]',
                )}
              >
                <AnimatePresence initial={false} mode="popLayout">
                  {list.map((item) => (
                    <motion.li
                      key={item.id}
                      layout="position"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: DUR.short, ease: EASE_OUT }}
                      className="flex min-w-0 flex-col gap-1"
                    >
                      <span className="relative block">
                        <ClipFrame sprite={item.sprite} className="w-full rounded-lg" />
                        <span className="absolute right-1 bottom-1 rounded-sm bg-viewer/75 px-1 tc-mono type-caption text-viewer-ink">
                          {clipLength(item.seconds)}
                        </span>
                      </span>
                      <span
                        className="line-clamp-2 min-h-[2lh] px-0.5 type-caption text-ink [overflow-wrap:anywhere]"
                        title={item.name}
                      >
                        {item.short}
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </motion.section>
          ))}
        </AnimatePresence>
        {days.length === 0 ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="inline-flex h-10 w-fit items-center gap-2 rounded-md border border-rule bg-control px-4 type-label text-ink hover:bg-control-hover active:bg-pressed"
          >
            <Clear aria-hidden className="size-4" />
            Clear search
          </button>
        ) : null}
      </div>
    </div>
  );
}
