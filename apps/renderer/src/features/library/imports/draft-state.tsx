// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ImportError } from './import-error';
import { useLingui } from '@lingui/react/macro';
import { IMPORT_COMMANDS, type ImportDraft, type ImportDraftId, type ImportMethod } from '@taalcut/core';
import { Button, EmptyState } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { Page } from '../../../shell/page';
import { METHOD_NAMES } from './import-words';
import { useImportCommand } from './use-import-command';

export function ImportLoading() {
  const { t } = useLingui();
  return (
    <div role="status" aria-label={t`Loading import`} className="flex flex-col gap-3" aria-busy>
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-16 rounded-md bg-sunken" />
      ))}
    </div>
  );
}
export function MissingImport() {
  const { t } = useLingui();
  return (
    <EmptyState
      title={t`This import is no longer here`}
      description={t`It may have been discarded. Choose a source to start again.`}
      action={
        <Button asChild>
          <Link to="/library/import">{t`Choose a source`}</Link>
        </Button>
      }
    />
  );
}
export function useDraft(draftId: ImportDraftId) {
  const backend = useBackend();
  const draft = useRpcQuery((signal) => backend.imports.draft({ draftId }, { signal }), [backend, draftId]);
  const command = useImportCommand();
  const update = async (patch: Partial<ImportDraft>) => {
    const result = await command.run(IMPORT_COMMANDS.updateDraft, { draftId, ...patch });
    if (result) draft.reload();
    return result !== null;
  };
  return { ...draft, update, pending: command.pending, writeError: command.error };
}
export function DraftFrame({
  method,
  draftId,
  step,
  children,
}: {
  method: ImportMethod;
  draftId: ImportDraftId;
  step: string;
  children: (draft: ImportDraft) => ReactNode;
}) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const query = useRpcQuery((signal) => backend.imports.draft({ draftId }, { signal }), [backend, draftId]);
  return (
    <Page
      title={t`Import`}
      detail={
        <>
          {i18n._(METHOD_NAMES[method])} · {step}
        </>
      }
      width="wide"
    >
      {query.error ? <ImportError error={query.error} onRetry={query.reload} /> : null}
      {query.status === 'loading' && !query.data ? (
        <ImportLoading />
      ) : query.data?.method === method && query.data.sessionId ? (
        <EmptyState
          title={t`This import has started`}
          description={t`Your saved selection belongs to an import. Open its progress and results.`}
          action={
            <Button asChild>
              <Link
                to="/library/imports/$sessionId"
                params={{ sessionId: query.data.sessionId }}
              >{t`Open import`}</Link>
            </Button>
          }
        />
      ) : query.data?.method === method ? (
        children(query.data)
      ) : query.status !== 'error' ? (
        <MissingImport />
      ) : null}
    </Page>
  );
}
