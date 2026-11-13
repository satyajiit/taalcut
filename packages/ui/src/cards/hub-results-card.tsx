// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4
 * Hallmark · component: hubResults card (U4) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a step panel on the sunken bed (results, not a decision): what was searched, up to 20
 *   HubTemplateRows (the same row as /templates/hub), "As of 3 hours ago" when the index is old, Show more
 * states: results · no results (one line, Show all) · stale index ("As of …") · a row removed since ("Removed from
 *   the hub", Fork off) · a row forking (its button spins) · forked ("In your templates", Open) · error (offline,
 *   not configured, Local only: the error line with its fix); the buttons carry the eight states
 * motion: none of its own (the rows' strips play on hover or focus)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { CardOf, HubBrowseItem, HubTemplateId } from '@taalcut/core';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '#components/button';
import { HubTemplateRow, type HubForkStatus, type HubRowItem } from '../hub/hub-template-row';
import { indexAge } from '../hub/hub-words';
import { useCardActions } from './card-actions';
import { useCardData } from './card-data';
import { UserContent } from './card-frame';
import { ErrorLine } from './error-line';

type Live = Readonly<Record<string, HubBrowseItem | null>>;

/** Each row as the index says now: null once it is gone (removed from the hub). A failed read keeps the snapshot. */
function useLiveItems(ids: readonly HubTemplateId[]): Live {
  const data = useCardData();
  const [live, setLive] = useState<Live>({});
  const key = ids.join(',');
  useEffect(() => {
    const read = data.hubItem;
    if (!read) return;
    let current = true;
    for (const id of ids)
      read(id).then(
        (item) => {
          if (current) setLive((previous) => ({ ...previous, [id]: item ?? null }));
        },
        () => undefined,
      );
    return () => {
      current = false;
    };
    // `key` stands for `ids`.
  }, [data, key]);
  return live;
}

export function HubResultsCard({ card }: { card: CardOf<'hubResults'> }) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const live = useLiveItems(card.items.map((item) => item.id));
  const [forks, setForks] = useState<Readonly<Record<string, HubForkStatus>>>({});
  const age = indexAge(i18n, card.indexFetchedAt, Date.now());
  const query = card.query;
  const hub = actions.hub;
  const navigate = actions.navigate;

  const fork = async (item: HubRowItem) => {
    if (!hub) return;
    setForks((previous) => ({ ...previous, [item.id]: { state: 'forking' } }));
    const result = await hub.fork({ hubId: item.id, version: item.version, sha256: item.sha256 });
    setForks((previous) => ({
      ...previous,
      [item.id]: result.ok
        ? { state: 'forked', templateId: result.value.templateId }
        : { state: 'error', error: result.error },
    }));
  };

  return (
    <article
      data-slot="smart-card"
      data-card-type="hubResults"
      aria-label={t`From the template hub`}
      className="flex max-w-[42rem] flex-col gap-3 rounded-xl bg-panel p-4"
    >
      <header className="flex flex-col gap-1">
        <h3 className="m-0 text-lg font-semibold text-ink">{t`From the template hub`}</h3>
        <p className="m-0 flex flex-wrap gap-x-2 text-sm text-ink-2">
          {card.query ? (
            <span>
              <Trans>
                Searched for{' '}
                <UserContent translate="no" className="text-ink">
                  {query}
                </UserContent>
              </Trans>
            </span>
          ) : null}
          {age ? (
            <span>
              {/* Intl's words for when the index was fetched, in a <time> as every Intl-formatted moment is; in the
                  sentence's own face, not mono (audit M3). */}
              <Trans>
                As of{' '}
                <time dateTime={new Date(card.indexFetchedAt).toISOString()} className="font-sans">
                  {age}
                </time>
              </Trans>
            </span>
          ) : null}
        </p>
      </header>
      {card.error ? (
        <ErrorLine error={card.error} {...(actions.runFix ? { onFix: actions.runFix } : {})} />
      ) : card.items.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 text-sm text-ink">{t`Nothing in the hub matches that yet.`}</p>
          {navigate ? (
            <Button size="sm" variant="ghost" onClick={() => navigate({ to: 'hub' })}>
              {t`Show all`}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul aria-label={t`Templates`} className="m-0 flex list-none flex-col p-0">
          {card.items.map((snapshot) => {
            const current = live[snapshot.id];
            const item: HubRowItem = current ?? snapshot;
            const status = forks[snapshot.id] ?? { state: 'idle' };
            return (
              <HubTemplateRow
                key={snapshot.id}
                item={item}
                removed={current === null}
                onOpen={() => navigate?.({ to: 'hub', hubId: snapshot.id })}
                {...(hub
                  ? {
                      fork: {
                        status,
                        onFork: () => void fork(item),
                        onOpenCopy: (templateId) => navigate?.({ to: 'template', templateId }),
                      },
                    }
                  : {})}
              />
            );
          })}
        </ul>
      )}
      {card.items.length > 0 && navigate ? (
        <Button
          size="sm"
          variant="ghost"
          className="w-fit"
          onClick={() => navigate({ to: 'hub', ...(card.query ? { query: card.query } : {}) })}
        >
          {t`Show more in the hub`}
          <ArrowRight aria-hidden />
        </Button>
      ) : null}
    </article>
  );
}
