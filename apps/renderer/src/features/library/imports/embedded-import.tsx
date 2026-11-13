// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { ImportDraftId, ImportMethod, ImportSessionId } from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery, useRpcStream } from '../../../backend/use-rpc';
import { ImportConnection } from './import-connect';
import { ImportSelection } from './import-choose';
import { ImportReviewContent } from './import-review';
import { ImportError } from './import-error';
import { ImportLoading } from './draft-state';
import { SessionProgress } from './session-progress';

/** First run uses the same explicit connection, saved selection and preflight as the Library. */
export function EmbeddedImport({
  method,
  onStarted,
}: {
  method: ImportMethod;
  onStarted: (sessionId: ImportSessionId) => void;
}) {
  const { t } = useLingui();
  const backend = useBackend();
  const drafts = useRpcQuery((signal) => backend.imports.drafts(undefined, { signal }), [backend]);
  const [draftId, setDraftId] = useState<ImportDraftId | null>(null);
  const [review, setReview] = useState(false);
  const [sessionId, setSessionId] = useState<ImportSessionId | null>(null);
  const sourceDraft = useRpcQuery(
    (signal) => (draftId ? backend.imports.draft({ draftId }, { signal }) : Promise.resolve(null)),
    [backend, draftId, sessionId],
  );
  const live = useRpcStream(
    (signal) => backend.imports.watch(sessionId ? { sessionId } : {}, { signal }),
    [backend, sessionId],
  );
  useEffect(() => {
    const saved = drafts.data?.find((draft) => draft.method === method && !draft.sessionId);
    if (saved) {
      setDraftId(saved.id);
      setReview(saved.watch || method === 'files');
    }
  }, [drafts.data, method]);
  const begin = (id: ImportDraftId, atReview: boolean) => {
    setDraftId(id);
    setReview(atReview);
  };
  const start = (id: ImportSessionId) => {
    setSessionId(id);
    onStarted(id);
  };
  const session = live.data?.sessions.find((entry) => entry.id === sessionId);
  return (
    <div className="flex flex-col gap-5">
      {drafts.error ? <ImportError error={drafts.error} onRetry={drafts.reload} /> : null}
      {sessionId ? (
        <>
          {session ? (
            <SessionProgress session={session} reference={sourceDraft.data?.storage === 'reference'} />
          ) : (
            <ImportLoading />
          )}
          <Button asChild variant="secondary" className="self-start">
            <Link to="/library/imports/$sessionId" params={{ sessionId }}>{t`Open import details`}</Link>
          </Button>
        </>
      ) : draftId ? (
        <>
          {review ? (
            <ImportReviewContent
              method={method}
              draftId={draftId}
              onStarted={start}
              onDiscarded={() => setDraftId(null)}
              onChoose={() => setReview(false)}
            />
          ) : (
            <ImportSelection method={method} draftId={draftId} onReview={() => setReview(true)} />
          )}
          <Button
            variant="ghost"
            className="self-start"
            onClick={() => setDraftId(null)}
          >{t`Choose another source`}</Button>
        </>
      ) : drafts.status === 'loading' ? (
        <ImportLoading />
      ) : (
        <ImportConnection method={method} onCreated={begin} />
      )}
    </div>
  );
}
