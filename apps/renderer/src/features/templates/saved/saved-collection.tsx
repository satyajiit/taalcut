// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a Saved collection (/templates/saved and /templates/saved/$collectionId; UX4
 *   tpl) · system: DESIGN.md v0.6 + UX4 (ListRow, EmptyState, Arrival; design-tpl.md)
 * the page's one job is reading saved reels into templates: the collections rail (links) beside the open one: how
 *   many reels it holds and when it was synced, with Sync now (watch-bar.tsx; watching is in Saved's settings),
 *   what its reels have in common (the style profile), the filter (caption or @creator, and Not yet templates as a
 *   switch with its words), then its reels as list rows, and Show more while there are more
 * states: filled · syncing (Sync now spins) · empty (Kaatu: save reels to it on Instagram, then Sync now) · no
 *   match (Clear filters) · a collection that isn't there (Kaatu, All Saved) · more (Show more, spinning)
 * motion: the list arrives (Arrival) when the collection or the filter changes
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Arrival, Button, CONCEPT_ICONS, EmptyState, Input, ListRows, Switch, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { StyleProfilePanel } from '../profiles/style-profile-panel';
import { TEMPLATE_ICONS } from '../template-icons';
import { CollectionRail } from './collection-rail';
import { SavedReelRow } from './saved-reel-row';
import { isSavedFiltered, type SavedSearch } from './saved-search';
import type { Saved } from './use-saved';
import { SyncLine } from './watch-bar';

export interface SavedCollectionProps {
  readonly saved: Saved;
  readonly collectionId: string;
  readonly search: SavedSearch;
  readonly onSearch: (next: SavedSearch) => void;
}

function Filters({ search, onSearch }: { search: SavedSearch; onSearch: (next: SavedSearch) => void }) {
  const { t } = useLingui();
  const searchId = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3" data-slot="saved-filters">
      <div className="min-w-52 flex-1">
        <label htmlFor={searchId} className="sr-only">
          <Trans>Search saved reels</Trans>
        </label>
        <span className="relative flex">
          <CONCEPT_ICONS.search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
          />
          <Input
            id={searchId}
            type="search"
            value={search.q ?? ''}
            placeholder={t`Filter by caption or @creator…`}
            onChange={(e) => onSearch({ ...search, q: e.target.value || undefined })}
            className="w-full ps-9"
          />
        </span>
      </div>
      <Switch
        checked={search.unlinked ?? false}
        onCheckedChange={(unlinked) => onSearch({ ...search, unlinked: unlinked || undefined })}
        label={<Trans>Not yet templates</Trans>}
        className="items-center"
      />
    </div>
  );
}

function Reels({ saved, search, onSearch }: Omit<SavedCollectionProps, 'collectionId'>) {
  const { t } = useLingui();
  if (saved.items.length === 0)
    return (
      <div data-slot="saved-empty">
        {isSavedFiltered(search) ? (
          <EmptyState
            variant="compact"
            icon={CONCEPT_ICONS.search}
            title={t`No saved reels match.`}
            description={t`Try another word, or show the reels that are already templates.`}
            action={
              <Button size="sm" variant="ghost" icon={VERB_ICONS.clearFilters} onClick={() => onSearch({})}>
                <Trans>Clear filters</Trans>
              </Button>
            }
          />
        ) : (
          <EmptyState
            variant="compact"
            kaatu="idle"
            title={t`No saved reels in this collection yet.`}
            description={t`Save Reels to this collection on Instagram, then press Sync now.`}
          />
        )}
      </div>
    );
  return (
    <Arrival animate>
      <div className="flex flex-col items-start gap-3">
        <ListRows framed aria-label={t`Saved reels`} className="w-full">
          {saved.items.map((reel) => (
            <SavedReelRow key={reel.shortcode} reel={reel} />
          ))}
        </ListRows>
        {saved.nextCursor ? (
          <Button size="sm" loading={saved.loadingMore} onClick={() => void saved.loadMore()}>
            <Trans>Show more</Trans>
          </Button>
        ) : null}
      </div>
    </Arrival>
  );
}

export function SavedCollection({ saved, collectionId, search, onSearch }: SavedCollectionProps) {
  const { t } = useLingui();
  const active = saved.active;
  return (
    <div
      data-slot="saved-browser"
      className="grid grid-cols-1 items-start gap-8 md:grid-cols-[fit-content(14rem)_minmax(0,1fr)]"
    >
      <CollectionRail collections={saved.collections} active={collectionId} />
      <div className="flex min-w-0 flex-col gap-5">
        {active ? (
          <>
            <SyncLine
              collection={active}
              onChanged={saved.reload}
              onSessionExpired={(error) => {
                saved.setAuthError(error);
                saved.reload();
              }}
            />
            <StyleProfilePanel source={{ kind: 'instagram-collection', collectionId: active.id }} />
            <Filters search={search} onSearch={onSearch} />
            <Reels saved={saved} search={search} onSearch={onSearch} />
          </>
        ) : (
          <div data-slot="saved-missing">
            <EmptyState
              titleAs="h2"
              kaatu="oops"
              title={t`This collection isn’t on Instagram any more`}
              description={t`It may have been renamed or deleted there. Your other collections are in the list.`}
              action={
                <Button asChild size="sm" icon={TEMPLATE_ICONS.all}>
                  <Link to="/templates/saved">{t`All Saved`}</Link>
                </Button>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
