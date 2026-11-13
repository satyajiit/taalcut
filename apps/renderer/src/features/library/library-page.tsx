// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* page: Library (UX4) · system: DESIGN.md v0.6 + UX4 (Page wide, Kaatu as companion, the motion grammar)
 * layout: search first (the one way people look for a shot), filters under it, then the import line while one
 *   runs, needs a look or just finished (import-line.tsx), then every clip in one windowed grid of 9:16 frames
 *   grouped by day under sticky headings (clip-grid.tsx); results replace the grid while searching. The page's
 *   actions (From your phone, Add folder) sit in the window bar (library-actions.tsx). While clips are picked, the
 *   bar of picks stands at the foot of the view with "Make a video with these" (bulk-bar.tsx).
 * states: loading (bone tiles from the first frame, until both the clips and the sources are known, so an empty
 *   library goes from bones straight to its drop zone) · empty library (the drop zone, LibraryEmpty, with Kaatu)
 *   · sources but no clips yet (NoClipsYet) · no matches (a filter set: the compact empty state and Clear
 *   filters) · failed files (?filter=failed: the import line's Details opens on each file and its reason)
 *   · searching · results · error (the cause and Try again) · importing (the line; results say how many clips
 *   search can't find yet) · analysing after an import (the same line) · picking (the boxes on every tile, the
 *   bar of picks) · first visit (one tip from Kaatu, gone for good once dismissed; not while the import line has a
 *   moment, so the page never has two)
 * motion: the grid's arrival (a capped cascade, transform and opacity); results arrive once (8 px rise); the
 *   import bar's transform; pictures fade in; the bar of picks rises in */
import { useLingui } from '@lingui/react/macro';
import type { AssetId, IndexingStatus, SearchResult, ShotId } from '@taalcut/core';
import { Button, EmptyState, ErrorLine, VERB_ICONS } from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { PageTip } from '../kaatu/page-tip';
import { BulkBar } from './bulk-bar';
import { ClipGrid } from './clip-grid';
import type { DayBasis } from './day-layout';
import { toLibraryFilters } from './filters';
import { ImportStrip, notSearchableYet, useIndexingStatus } from './import-strip';
import { summariseImports } from './import-summary';
import { LibraryEmpty, NoClipsYet } from './library-empty';
import { hasFilters, NO_FILTERS, type LibrarySearch } from './library-search';
import { LibraryToolbar } from './library-toolbar';
import { SearchResults } from './search-results';
import { useClipSelection } from './selection';
import { useAssetPages } from './use-asset-pages';

/** An import is running: the line shows it. */
const importing = (status: IndexingStatus | null) => status?.sources.some((s) => s.state !== 'done') ?? false;

/** True from the first time the import line has something to say on this visit. */
function useImportSeen(status: IndexingStatus | null): boolean {
  const [seen, setSeen] = useState(false);
  const now = summariseImports(status).kind !== 'none';
  if (now && !seen) setSeen(true);
  return seen || now;
}

/** Days are counted from the date the grid is sorted by; sorted by length or quality, there are none. */
function dayBasisOf(sort: LibrarySearch['sort']): DayBasis | null {
  const by = sort ?? 'captured';
  return by === 'captured' || by === 'added' ? by : null;
}

export function LibraryPage({
  search,
  onSearch,
  now,
}: {
  search: LibrarySearch;
  onSearch: (next: Partial<LibrarySearch>) => void;
  now?: number;
}) {
  const { t } = useLingui();
  const backend = useBackend();
  const [sourcesRound, setSourcesRound] = useState(0);
  const [searchRound, setSearchRound] = useState(0);
  const sources = useRpcQuery(
    (signal) => backend.library.sources(undefined, { signal }),
    [backend, sourcesRound],
  );
  const filters = toLibraryFilters(search);
  const sort = search.sort ?? 'captured';
  const direction = search.dir ?? 'desc';
  const pages = useAssetPages(filters, sort, direction);
  const [indexing, setIndexing] = useIndexingStatus();
  const looking = Boolean(search.q || search.similar);
  const filterKey = JSON.stringify(filters);
  const gridKey = `${filterKey}|${sort}|${direction}`;
  const selection = useClipSelection(pages.items, gridKey);
  useBackendEvents(['library.changed'], ({ payload }) => {
    if (payload.entity === 'source') {
      setSourcesRound((n) => n + 1);
      setSearchRound((n) => n + 1);
    } else if (payload.entity === 'asset') {
      if (payload.change !== 'updated') setSourcesRound((n) => n + 1);
      if (payload.change === 'deleted') selection.pickMany(payload.ids as AssetId[], false);
      setSearchRound((n) => n + 1);
    }
  });
  const results = useRpcQuery<SearchResult | null>(
    (signal) =>
      search.similar
        ? backend.library.findSimilar({ shotId: search.similar, filters }, { signal })
        : search.q
          ? backend.library.search({ query: search.q, filters }, { signal })
          : Promise.resolve(null),
    [backend, search.q, search.similar, filterKey, searchRound],
  );

  // One moment at a time: once the import line has had something to say this visit (and so may have its own
  // moment, a finished or a stopped import), the first-visit tip stands down.
  const importSeen = useImportSeen(indexing);
  const unfiltered = !hasFilters(search) && !looking;
  // Nothing in the library at all: the drop zone teaches the one action that fills it.
  if (pages.total === 0 && unfiltered && sources.data?.length === 0) return <LibraryEmpty />;

  // No clips and no filters: bones until the sources say whether this is an empty library (no flash of "no matches").
  const deciding = pages.total === 0 && unfiltered && sources.status === 'loading';
  const loading = (pages.total === null && !pages.error) || deciding;
  const findSimilar = (shotId: ShotId) => onSearch({ similar: shotId, q: undefined });
  return (
    <div className="flex flex-col gap-6" data-slot="library">
      {pages.total !== 0 && !importSeen ? (
        <PageTip id="library">
          {t`Point at a clip to play it, find shots like it, or tick it. Tick a few and make a video with them.`}
        </PageTip>
      ) : null}
      <LibraryToolbar
        search={search}
        onChange={onSearch}
        sources={sources.data ?? []}
        count={pages.total}
        searching={results.status === 'loading' && looking}
      />
      <ImportStrip
        sources={sources.data ?? []}
        status={indexing}
        setStatus={setIndexing}
        onSeeFailed={() => onSearch({ filter: 'failed', q: undefined })}
      />

      {looking ? (
        <SearchResults
          query={search.q ?? null}
          result={results.data ?? undefined}
          error={results.error}
          loading={results.status === 'loading'}
          onRetry={results.reload}
          onSimilar={findSimilar}
          onClear={() => onSearch({ q: undefined, similar: undefined })}
          notSearchable={notSearchableYet(indexing)}
        />
      ) : pages.error && pages.items.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorLine error={pages.error} />
          <Button size="sm" icon={VERB_ICONS.retry} onClick={pages.reload}>
            {t`Try again`}
          </Button>
        </div>
      ) : pages.total === 0 && !deciding && unfiltered ? (
        <NoClipsYet importing={importing(indexing)} />
      ) : pages.total === 0 && !deciding ? (
        <EmptyState
          variant="compact"
          icon={VERB_ICONS.clearFilters}
          title={t`No clips match these filters.`}
          description={t`Try a wider time or another shape.`}
          action={
            <Button size="sm" icon={VERB_ICONS.clearFilters} onClick={() => onSearch(NO_FILTERS)}>
              {t`Clear filters`}
            </Button>
          }
        />
      ) : (
        <div data-slot={loading ? 'loading' : undefined} aria-busy={loading || undefined}>
          {loading ? <span className="sr-only">{t`Loading your clips`}</span> : null}
          <ClipGrid
            items={pages.items}
            total={loading ? 24 : (pages.total ?? 24)}
            ensure={pages.ensure}
            days={dayBasisOf(search.sort)}
            selection={selection}
            onFindSimilar={findSimilar}
            loading={loading}
            arrivalKey={gridKey}
            {...(now ? { now } : {})}
          />
        </div>
      )}
      {selection.selecting && !looking ? (
        <BulkBar ids={selection.ids} items={pages.items} onDone={selection.clear} />
      ) : null}
    </div>
  );
}
