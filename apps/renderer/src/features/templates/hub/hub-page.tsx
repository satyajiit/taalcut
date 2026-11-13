// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · page: Start from… › Community (/templates/start/community, was /templates/hub; P3-B12,
 *   P3-V8, UX4 tpl) · system: DESIGN.md v0.6 + UX4 (design-tpl.md)
 * what others shared, structure only and free to use, as Start from… cards: the frame (start-frame.tsx) first,
 *   then what holds the hub back (hub-notices.tsx), the filters, then the cards (each its storyboard, name,
 *   description, facts, Use for a video and Copy to my templates; the name opens its page)
 * states: loading (the "hub-list" skeleton) · results · settling (dimmed, aria-busy) · no results (EmptyState
 *   compact, Clear filters) · offline with a cached index (a line: how old the list is, what waits, Try again) ·
 *   rate-limited (a line: what waits and until when) · Local only (Kaatu, the reason, Open Privacy) · not set up on
 *   this device (Kaatu, the reason); the tip stays away while the page is one of these two
 * motion: cards arrive once; a card's storyboard plays on hover or focus
 */
import { useCallback, useState } from 'react';
import { StartFrame } from '../start/start-frame';
import { HubBlocked } from './hub-blocked';
import { HubFilters } from './hub-filters';
import { HubList } from './hub-list';
import { HubNotices } from './hub-notices';
import type { HubSearch } from './hub-search';
import { hubBlock, useHubStatus } from './use-hub-status';

export interface HubPageProps {
  readonly search: HubSearch;
  readonly onSearch: (next: HubSearch) => void;
}

export function HubPage({ search, onSearch }: HubPageProps) {
  const status = useHubStatus();
  const [tags, setTags] = useState<readonly string[]>([]);
  const onTags = useCallback((next: readonly string[]) => setTags(next), []);
  const block = hubBlock(status.data);
  return (
    <StartFrame view="community" tip={!block}>
      {block ? (
        <HubBlocked block={block} />
      ) : (
        <div data-slot="hub" className="flex flex-col gap-6">
          <HubNotices
            fetchedAt={status.data?.indexFetchedAt ?? null}
            checking={status.checking}
            onRetry={status.check}
          />
          <HubFilters search={search} onSearch={onSearch} tags={tags} />
          <HubList
            search={search}
            round={status.round}
            onTags={onTags}
            onClear={() => onSearch({ ...(search.sort ? { sort: search.sort } : {}) })}
          />
        </div>
      )}
    </StartFrame>
  );
}
