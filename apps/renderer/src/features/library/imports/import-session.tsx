// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ImportError } from './import-error';
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, type ImportItemOutcome, type ImportSessionId, type TaalcutError } from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery, useRpcStream } from '../../../backend/use-rpc';
import { Page } from '../../../shell/page';
import { ImportLoading, MissingImport } from './draft-state';
import { OUTCOME_NAMES } from './import-words';
import { SessionProgress } from './session-progress';

export function ImportSessionPage({ sessionId }: { sessionId: ImportSessionId }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const detail = useRpcQuery(
    (signal) => backend.imports.session({ sessionId, limit: 100 }, { signal }),
    [backend, sessionId],
  );
  const live = useRpcStream(
    (signal) => backend.imports.watch({ sessionId }, { signal }),
    [backend, sessionId],
  );
  const session = live.data?.sessions[0] ?? detail.data?.session;
  const sourceDraft = useRpcQuery(
    (signal) =>
      session?.draftId
        ? backend.imports.draft({ draftId: session.draftId }, { signal })
        : Promise.resolve(null),
    [backend, session?.draftId],
  );
  const [older, setOlder] = useState<ImportItemOutcome[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<TaalcutError | null>(null);
  useEffect(() => {
    setOlder([]);
    setCursor(detail.data?.nextCursor);
  }, [detail.data]);
  useEffect(() => {
    if (session) detail.reload();
  }, [
    session?.status,
    session?.progress.completedItems,
    session?.progress.failedItems,
    session?.progress.skippedItems,
    session?.progress.archivedItems,
  ]);
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    const result = await callRpc(backend.imports.session({ sessionId, cursor, limit: 100 }));
    if (result.ok && result.value) {
      setOlder((items) => [...items, ...result.value!.items]);
      setCursor(result.value.nextCursor);
    } else if (!result.ok) setLoadError(result.error);
    setLoadingMore(false);
  };
  const items = [...(detail.data?.items ?? []), ...older];
  return (
    <Page title={t`Import`} detail={session?.sourceLabel} width="wide">
      {detail.error ? <ImportError error={detail.error} onRetry={detail.reload} /> : null}
      {live.error ? <ImportError error={live.error} onRetry={live.reload} /> : null}
      {loadError ? <ImportError error={loadError} onRetry={() => void loadMore()} /> : null}
      {session ? (
        <>
          <SessionProgress session={session} reference={sourceDraft.data?.storage === 'reference'} />
          {session.progress.archivedItems > 0 ? (
            <p className="m-0 rounded-lg bg-panel p-4 type-body text-ink-2">
              <Trans>
                Archived captures keep your originals and required companions. They are separate from clips
                available to edit and are not queued for ordinary analysis.
              </Trans>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {session.method === 'phone-wifi' && session.status === 'running' ? (
              <Button asChild variant="secondary">
                <Link
                  to="/library/import/$method"
                  params={{ method: 'phone-wifi' }}
                >{t`Return to phone reception`}</Link>
              </Button>
            ) : null}
            {session.progress.completedItems + session.progress.skippedItems > 0 ? (
              <Button asChild variant="primary">
                <Link
                  to="/library"
                  search={session.sourceId ? { source: session.sourceId } : {}}
                >{t`Open imported clips`}</Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary">
              <Link to="/library/imports">{t`All imports`}</Link>
            </Button>
          </div>
          <section className="flex flex-col gap-3">
            <h2 className="m-0 type-section">{t`File outcomes`}</h2>
            <div className="divide-y divide-rule-subtle border-y border-rule-subtle">
              {items.map((item) => (
                <div key={item.itemId} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <span className="min-w-0 break-all type-body" translate="no">
                      {item.name}
                    </span>
                    <span className="shrink-0 type-meta text-ink-2">{i18n._(OUTCOME_NAMES[item.state])}</span>
                  </div>
                  {item.error ? <ImportError error={item.error} /> : null}
                  {item.result?.kind === 'archived' && !item.result.complete ? (
                    <p className="m-0 type-meta text-warning-strong">{t`Capture incomplete. Reimport with the missing originals to repair it.`}</p>
                  ) : null}
                </div>
              ))}
            </div>
            {cursor ? (
              <Button
                variant="secondary"
                loading={loadingMore}
                onClick={() => void loadMore()}
              >{t`Load more outcomes`}</Button>
            ) : null}
          </section>
        </>
      ) : detail.status === 'loading' ? (
        <ImportLoading />
      ) : detail.data === null ? (
        <MissingImport />
      ) : null}
    </Page>
  );
}
