// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ImportError } from './import-error';
import { Trans, useLingui } from '@lingui/react/macro';
import type { SourceId, SourceView } from '@taalcut/core';
import { Button, EmptyState } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Folder, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Page } from '../../../shell/page';
import { SourceRow } from '../../settings/sources/source-row';
import { SourceStatusLine, useSourceState } from '../../settings/sources/source-status';
import { useSources } from '../../settings/sources/use-sources';
import { useSourceActions } from '../../settings/sources/use-source-actions';
import { LibraryActions } from '../library-actions';
import { LibraryPage } from '../library-page';
import type { LibrarySearch } from '../library-search';
import { ImportLoading } from './draft-state';
import { SourceRelink } from './source-relink';
import { LibraryViews } from './library-views';
import { MountedSources } from './mounted-sources';

function SourceLink({ source }: { source: SourceView }) {
  const state = useSourceState(source, undefined);
  return (
    <Link
      to="/library/sources/$sourceId"
      params={{ sourceId: source.id }}
      className="flex items-center gap-4 rounded-md px-3 py-4 text-ink hover:bg-hover"
    >
      <Folder aria-hidden className="size-5 shrink-0 text-ink-2" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate type-card-title" translate="no">
          {source.name}
        </span>
        <SourceStatusLine state={state} />
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
    </Link>
  );
}
export function LibrarySources() {
  const { t } = useLingui();
  const { sources } = useSources();
  return (
    <Page
      title={t`Library`}
      detail={t`Sources`}
      views={<LibraryViews />}
      actions={<LibraryActions />}
      description={t`Your folders, phones and cameras. Check what is connected and keep your footage available.`}
    >
      <MountedSources />
      {sources.error ? <ImportError error={sources.error} onRetry={sources.reload} /> : null}
      {sources.status === 'loading' && !sources.data ? (
        <ImportLoading />
      ) : sources.data?.length ? (
        <div className="divide-y divide-rule-subtle border-y border-rule-subtle">
          {sources.data.map((source) => (
            <SourceLink key={source.id} source={source} />
          ))}
        </div>
      ) : sources.data ? (
        <EmptyState
          title={t`Connect your first source`}
          description={t`Import once from a phone, camera or Photos, or watch a folder for new footage.`}
          action={
            <Button asChild variant="secondary">
              <Link to="/library/import">{t`Choose a source`}</Link>
            </Button>
          }
        />
      ) : null}
    </Page>
  );
}
export function LibrarySourceDetail({ sourceId }: { sourceId: SourceId }) {
  const { t } = useLingui();
  const { sources, importOf } = useSources();
  const actions = useSourceActions();
  const source = sources.data?.find((item) => item.id === sourceId);
  const [search, setSearch] = useState<LibrarySearch>({ source: sourceId });
  return (
    <Page title={t`Sources`} detail={source?.name} width="wide" actions={<LibraryActions />}>
      {sources.error ? <ImportError error={sources.error} onRetry={sources.reload} /> : null}
      {source ? (
        <>
          <section aria-label={t`Source health`} className="flex flex-col gap-4">
            <SourceRow source={source} running={importOf(sourceId)} actions={actions} />
            {source.kind === 'watched_folder' ? (
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  disabled={actions.busyOf(sourceId) !== null}
                  onClick={() => void actions.rescan(source)}
                >{t`Rescan folder`}</Button>
                <Button
                  variant="secondary"
                  disabled={actions.busyOf(sourceId) !== null}
                  onClick={() => void actions.setWatch(source, !source.watch)}
                >
                  {source.watch ? t`Stop watching` : t`Watch for new footage`}
                </Button>
              </div>
            ) : null}
            {source.missing > 0 || source.status !== 'online' ? (
              <SourceRelink sourceId={sourceId} onRelinked={sources.reload} />
            ) : null}
            <p className="m-0 type-body text-ink-2">
              <Trans>Removing a source from Taalcut never deletes its original files.</Trans>
            </p>
          </section>
          <section className="flex flex-col gap-4 border-t border-rule-subtle pt-5">
            <h2 className="m-0 type-section">{t`Footage from this source`}</h2>
            <LibraryPage
              search={{ ...search, source: sourceId }}
              onSearch={(patch) => setSearch((value) => ({ ...value, ...patch, source: sourceId }))}
            />
          </section>
        </>
      ) : sources.status === 'loading' ? (
        <ImportLoading />
      ) : sources.data ? (
        <EmptyState
          title={t`Source no longer connected`}
          description={t`It may have been removed from the library.`}
          action={
            <Button asChild>
              <Link to="/library/sources">{t`All sources`}</Link>
            </Button>
          }
        />
      ) : null}
    </Page>
  );
}
