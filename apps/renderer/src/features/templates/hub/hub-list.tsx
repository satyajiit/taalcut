// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the community's cards (/templates/start/community; P3-B12, UX4 tpl) · system:
 *   DESIGN.md v0.6 + UX4 (design-tpl.md, "The Start from… card")
 * the browse results as Start from… cards (community-card.tsx), 20 at a time with Show more; a card's name opens its
 *   page, and its two actions start a video from it or copy it
 * states: loading (the "hub-list" skeleton: bones captured from real cards) · results · settling (the cards answer
 *   older filters while the new answer loads: StaleContent) · no results (EmptyState compact: Clear filters) ·
 *   error (the cause, Try again) · more loading (Show more spins) · more failed (its error line under the cards)
 * motion: cards arrive once (Arrival); a card's storyboard plays on hover or focus
 */
import { useLingui } from '@lingui/react/macro';
import { callRpc, type HubBrowseItem, type TaalcutError } from '@taalcut/core';
import {
  Arrival,
  Button,
  CONCEPT_ICONS,
  EmptyState,
  ErrorLine,
  Skeleton,
  StaleContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { useEffect, useMemo, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery } from '../../../backend/use-rpc';
import { CardsFixture, CommunityCard } from '../start/community-card';
import { CARD_GRID, CardBones } from '../start/start-card';
import { browseQueryOf, isFiltered, type HubSearch } from './hub-search';

export interface HubListProps {
  readonly search: HubSearch;
  /** Counts the page's hub checks (Try again): each reads the list again. */
  readonly round: number;
  onClear(): void;
  /** The tags in what is listed, most common first (the filters offer them). */
  onTags(tags: readonly string[]): void;
}

function commonTags(items: readonly HubBrowseItem[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 12)
    .map(([tag]) => tag);
}

export function HubList({ search, round, onClear, onTags }: HubListProps) {
  const { t } = useLingui();
  const backend = useBackend();
  const key = `${JSON.stringify(browseQueryOf(search))}#${round}`;
  const first = useRpcQuery(
    async (signal) => ({ key, page: await backend.hub.browse(browseQueryOf(search), { signal }) }),
    [backend, key],
  );
  const page = first.data?.page;
  const settling = first.data !== undefined && first.data.key !== key;
  const [more, setMore] = useState<{ items: HubBrowseItem[]; cursor: string | null }>({
    items: [],
    cursor: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<TaalcutError | null>(null);

  useEffect(() => {
    setMore({ items: [], cursor: page?.nextCursor ?? null });
    setMoreError(null);
  }, [page]);
  // A copy or its undo changes a row's "In your templates".
  useBackendEvents(['library.changed'], ({ payload }) => {
    if (payload.entity === 'template') first.reload();
  });

  const items = useMemo(() => [...(page?.items ?? []), ...more.items], [page, more.items]);
  useEffect(() => onTags(commonTags(items)), [items, onTags]);

  const loadMore = async () => {
    if (!more.cursor) return;
    setLoadingMore(true);
    const next = await callRpc(backend.hub.browse(browseQueryOf(search, more.cursor)));
    setLoadingMore(false);
    if (!next.ok) return setMoreError(next.error);
    setMoreError(null);
    setMore((previous) => ({
      items: [...previous.items, ...next.value.items],
      cursor: next.value.nextCursor,
    }));
  };

  if (first.error && !page)
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorLine error={first.error} />
        <Button size="sm" icon={VERB_ICONS.retry} onClick={first.reload}>
          {t`Try again`}
        </Button>
      </div>
    );
  if (page && items.length === 0)
    return (
      <div data-slot="hub-empty">
        <EmptyState
          variant="compact"
          icon={CONCEPT_ICONS.search}
          title={t`No templates match.`}
          description={t`Try fewer filters or other words.`}
          {...(isFiltered(search)
            ? {
                action: (
                  <Button size="sm" variant="ghost" icon={VERB_ICONS.clearFilters} onClick={onClear}>
                    {t`Clear filters`}
                  </Button>
                ),
              }
            : {})}
        />
      </div>
    );
  return (
    <div aria-busy={!page || undefined}>
      {page ? null : (
        <span role="status" className="sr-only">
          {t`Loading the hub`}
        </span>
      )}
      <Skeleton name="hub-list" loading={!page} fallback={<CardBones />} fixture={<CardsFixture />}>
        {page ? (
          <StaleContent stale={settling} className="flex flex-col gap-4">
            <Arrival animate>
              <ul aria-label={t`Templates in the hub`} className={CARD_GRID} data-slot="hub-cards">
                {items.map((item) => (
                  <CommunityCard key={item.id} item={item} />
                ))}
              </ul>
            </Arrival>
            {moreError ? <ErrorLine error={moreError} onRetry={() => void loadMore()} /> : null}
            {more.cursor ? (
              <Button size="sm" className="w-fit" loading={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? t`Loading more` : t`Show more`}
              </Button>
            ) : null}
          </StaleContent>
        ) : null}
      </Skeleton>
    </div>
  );
}
