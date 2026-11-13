// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ImportError } from './import-error';
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, type ImportSession, type TaalcutError } from '@taalcut/core';
import { Button, EmptyState } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery, useRpcStream } from '../../../backend/use-rpc';
import { Page } from '../../../shell/page';
import { LibraryActions } from '../library-actions';
import { usePhoneFlow } from '../phone/session/phone-flow';
import { TransferFiles } from '../phone/transfers/transfer-files';
import { ImportLoading } from './draft-state';
import { LibraryViews } from './library-views';
import { METHOD_NAMES, SESSION_NAMES, STAGE_NAMES } from './import-words';

export function ImportsPage({ phones = false }: { phones?: boolean }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const phone = usePhoneFlow();
  const live = useRpcStream((signal) => backend.imports.watch({}, { signal }), [backend]);
  const history = useRpcQuery(
    (signal) =>
      backend.imports.history(
        { ...(phones ? { methods: ['phone-wifi', 'phone-cable'] } : {}), limit: 100 },
        { signal },
      ),
    [backend, phones],
  );
  const [older, setOlder] = useState<ImportSession[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<TaalcutError | null>(null);
  useEffect(() => {
    setOlder([]);
    setCursor(history.data?.nextCursor);
  }, [history.data]);
  const entries = new Map([...older, ...(history.data?.items ?? [])].map((entry) => [entry.id, entry]));
  for (const entry of live.data?.sessions ?? [])
    if (!phones || entry.method.startsWith('phone-')) entries.set(entry.id, entry);
  const items = [...entries.values()].sort((a, b) => b.createdAt - a.createdAt);
  const active = items.filter((entry) => ['running', 'paused', 'interrupted'].includes(entry.status));
  const previous = items.filter((entry) => !active.includes(entry));
  const rows = (sessions: ImportSession[]) => (
    <div className="divide-y divide-rule-subtle border-y border-rule-subtle">
      {sessions.map((entry) => (
        <Link
          key={entry.id}
          to="/library/imports/$sessionId"
          params={{ sessionId: entry.id }}
          className="flex min-h-20 flex-wrap items-center justify-between gap-3 rounded-md px-3 py-4 text-ink hover:bg-hover"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate type-card-title" translate="no">
              {entry.sourceLabel}
            </span>
            <span className="type-meta text-ink-2">
              {i18n._(METHOD_NAMES[entry.method])} ·{' '}
              {new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
                entry.createdAt,
              )}
            </span>
          </span>
          <span className="text-end">
            <span className="block type-label">{i18n._(SESSION_NAMES[entry.status])}</span>
            <span className="type-meta text-ink-2">{i18n._(STAGE_NAMES[entry.stage])}</span>
          </span>
        </Link>
      ))}
    </div>
  );
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    const result = await callRpc(
      backend.imports.history({
        ...(phones ? { methods: ['phone-wifi', 'phone-cable'] } : {}),
        cursor,
        limit: 100,
      }),
    );
    if (result.ok) {
      setOlder((items) => [...items, ...result.value.items]);
      setCursor(result.value.nextCursor);
    } else setLoadError(result.error);
    setLoadingMore(false);
  };
  return (
    <Page
      title={t`Library`}
      detail={t`Imports`}
      width="wide"
      views={<LibraryViews />}
      actions={<LibraryActions />}
    >
      {phones ? (
        <p className="m-0 type-body text-ink-2">
          <Trans>Showing phone imports.</Trans>{' '}
          <Link
            to="/library/imports"
            search={{ phones: false }}
            className="underline underline-offset-4"
          >{t`Show all imports`}</Link>
        </p>
      ) : null}
      {phone.transfer.enabled && phone.transfer.session?.state !== 'stopped' ? (
        <section className="flex flex-col gap-3 border-b border-rule-subtle pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 type-section">{t`Phone Wi-Fi reception`}</h2>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void phone.transfer.stop()}
            >{t`Stop listening`}</Button>
          </div>
          <p className="m-0 type-body text-ink-2">{t`Reception continues while you work. Choose footage on your phone.`}</p>
          <TransferFiles files={phone.transfer.files} onCancel={phone.transfer.cancelUpload} />
          <Button asChild variant="ghost" className="self-start">
            <Link to="/library/import/$method" params={{ method: 'phone-wifi' }}>{t`Show connection`}</Link>
          </Button>
        </section>
      ) : null}
      {history.error ? <ImportError error={history.error} onRetry={history.reload} /> : null}
      {live.error ? <ImportError error={live.error} onRetry={live.reload} /> : null}
      {loadError ? <ImportError error={loadError} onRetry={() => void loadMore()} /> : null}
      {!history.data && history.status === 'loading' ? <ImportLoading /> : null}
      {active.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 type-section">{t`In progress`}</h2>
          {rows(active)}
        </section>
      ) : null}
      {previous.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 type-section">{t`History`}</h2>
          {rows(previous)}
        </section>
      ) : null}
      {history.data && items.length === 0 ? (
        <EmptyState
          title={t`Your imports will appear here`}
          description={t`Follow progress, review what arrived and retry anything unfinished. You can keep working during an import.`}
          action={
            <Button asChild variant="secondary">
              <Link to="/library/import">{t`Choose a source`}</Link>
            </Button>
          }
        />
      ) : null}
      {cursor ? (
        <Button
          variant="secondary"
          loading={loadingMore}
          onClick={() => void loadMore()}
        >{t`Load older imports`}</Button>
      ) : null}
    </Page>
  );
}
