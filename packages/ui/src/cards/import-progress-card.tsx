// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: importProgress card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a step panel on the sunken bed (packages/ui SPEC rule 6): no stripe, no shadow, no card in a card
 * states: the view's (library/import-progress.tsx); error: a failed Pause, Resume or Retry says why under the actions,
 *   the progress stays; live: follows library.indexing through CardData, else its snapshot
 *   · LRN1-TPL: under it, the saved templates these clips fill (fit/templates-that-fit.tsx, its own states)
 */
import { useLingui } from '@lingui/react/macro';
import type { CardOf, ImportStatus, Result, TaalcutError } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { TemplatesThatFit } from '../fit/templates-that-fit';
import { ImportProgressView } from '../library/import-progress';
import { useCardActions } from './card-actions';
import { useCardData } from './card-data';
import { UserContent } from './card-frame';
import { ErrorLine } from './error-line';

/** The import's source name, from CardData; null until it arrives (or without it). */
export function useSourceName(sourceId: string): string | null {
  const data = useCardData();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    data.sources?.().then(
      (sources) => live && setName(sources.find((source) => source.id === sourceId)?.name ?? null),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data, sourceId]);
  return name;
}

export function ImportProgressCard({ card }: { card: CardOf<'importProgress'> }) {
  const { t } = useLingui();
  const data = useCardData();
  const actions = useCardActions();
  const [status, setStatus] = useState<ImportStatus>(card.status);
  const [pending, setPending] = useState<'pause' | 'resume' | 'retry' | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const name = useSourceName(card.sourceId);

  useEffect(() => setStatus(card.status), [card.status]);
  useEffect(
    () => data.watchImport?.(card.sourceId, (next) => next && setStatus(next)),
    [data, card.sourceId],
  );

  const run = (kind: 'pause' | 'resume' | 'retry', call: () => Promise<Result<unknown>>) => async () => {
    setPending(kind);
    setError(null);
    const result = await call();
    setPending(null);
    if (!result.ok) setError(result.error);
  };
  const indexing = actions.indexing;

  return (
    <div
      data-slot="smart-card"
      data-card-type="importProgress"
      className="flex max-w-[42rem] flex-col gap-2 rounded-xl bg-panel p-4"
    >
      <ImportProgressView
        status={status}
        source={name ? <UserContent translate="no">{name}</UserContent> : t`your footage`}
        thumbnails={card.thumbnails.map((ref) => data.mediaUrl?.(ref) ?? null)}
        pending={pending}
        {...(indexing
          ? {
              onPause: run('pause', () => indexing.pause()),
              onResume: run('resume', () => indexing.resume()),
              onRetry: run('retry', () => indexing.retryFailed(card.sourceId)),
            }
          : {})}
        {...(actions.navigate
          ? {
              onSeeFailed: () => actions.navigate?.({ to: 'library', filter: 'failed' }),
              // UX1-IMPORT: an import whose clips wait for a model says so, with the way to it.
              onOpenModels: () => actions.navigate?.({ to: 'settings', section: 'models' }),
            }
          : {})}
      />
      {error ? <ErrorLine error={error} /> : null}
      {/* LRN1-TPL: which saved templates these clips already fill, once search can find some of them. */}
      <TemplatesThatFit
        sourceId={card.sourceId}
        searchable={status.counts.searchable ?? 0}
        finished={status.state === 'done'}
      />
    </div>
  );
}
