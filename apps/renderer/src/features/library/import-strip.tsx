// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the Library's imports, as one line (UX4, B12) · system: DESIGN.md v0.6 + UX4 · background work runs
 *   neutral: the import line under the search and filters while an import runs, needs a look or just finished,
 *   gone when there is nothing to say (import-line.tsx)
 * states: loading (no status after 300 ms: bones in the line's shape while it asks for the status itself, so a
 *   quick answer doesn't flash and a failed first read doesn't leave a gap) · nothing to say (nothing) · the line's
 *   own (running, paused, waiting, needs a look, stopped, analysing, finished) · error reading the status (the
 *   cause and Try again)
 */
import { useLingui } from '@lingui/react/macro';
import { callRpc, type IndexingStatus, type SourceView, type TaalcutError } from '@taalcut/core';
import { Button, ErrorLine, VERB_ICONS } from '@taalcut/ui';
import { useCallback, useEffect, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { ImportLine } from './import-line';

/** Whether the status loaded, and how to ask again when it didn't. */
export interface IndexingLoad {
  readonly error: TaalcutError | null;
  readonly reload: () => void;
}

/**
 * Indexing as it moves on: the status at mount, then every library.indexing event. The library page holds it and
 * hands it to the strip and to search's "not searchable yet" line. A failed read is kept, with a way to ask again.
 */
export function useIndexingStatus(): [IndexingStatus | null, (next: IndexingStatus) => void, IndexingLoad] {
  const backend = useBackend();
  const [status, setStatus] = useState<IndexingStatus | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void callRpc(backend.indexing.status(undefined, { signal: controller.signal })).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setStatus(result.value);
      else setError(result.error);
    });
    return () => controller.abort();
  }, [backend, attempt]);
  useBackendEvents(['library.indexing'], ({ payload }) => {
    setError(null);
    setStatus(payload);
  });
  useBackendEvents(['library.changed'], ({ payload }) => {
    if ((payload.entity === 'asset' && payload.change !== 'updated') || payload.entity === 'source') {
      setAttempt((n) => n + 1);
    }
  });
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return [status, setStatus, { error, reload }];
}

/** Clips in running imports that search can't find yet (failed ones never will; they are left out). */
export function notSearchableYet(status: IndexingStatus | null): number {
  if (!status || !status.sources.some((source) => source.state !== 'done' && source.state !== 'failed'))
    return 0;
  const { assets, failed, searchable } = status.overall;
  return searchable === undefined ? 0 : Math.max(0, assets - searchable - failed);
}

export function ImportStrip({
  sources,
  status,
  setStatus,
  onSeeFailed,
}: {
  sources: readonly SourceView[];
  /** From useIndexingStatus, held by the page; the strip fills it itself when it is late. */
  status: IndexingStatus | null;
  setStatus: (next: IndexingStatus) => void;
  onSeeFailed: () => void;
}) {
  const late = useLateStatus(status, setStatus);
  if (!status) {
    if (late.error) return <StatusError error={late.error} onRetry={late.retry} />;
    return late.waited ? <StripBones /> : null;
  }
  return <ImportLine status={status} sources={sources} setStatus={setStatus} onSeeFailed={onSeeFailed} />;
}

/**
 * Without a status 300 ms in, the strip asks for it itself: a read that failed (or never came) gets its cause and
 * Try again instead of an empty space. A status that arrives fills the page's too.
 */
function useLateStatus(status: IndexingStatus | null, setStatus: (next: IndexingStatus) => void) {
  const backend = useBackend();
  const [waited, setWaited] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const missing = status === null;
  useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => setWaited(true), 300);
    return () => clearTimeout(timer);
  }, [missing]);
  useEffect(() => {
    if (!missing || !waited) return;
    const controller = new AbortController();
    setError(null);
    void callRpc(backend.indexing.status(undefined, { signal: controller.signal })).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setStatus(result.value);
      else setError(result.error);
    });
    return () => controller.abort();
  }, [backend, missing, waited, attempt, setStatus]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { waited, error, retry };
}

/** The status couldn't be read: why, and Try again (reading it again changes nothing). */
function StatusError({ error, onRetry }: { error: TaalcutError; onRetry: () => void }) {
  const { t } = useLingui();
  return (
    <div data-slot="import-strip" data-state="error" className="flex flex-col gap-1.5">
      <p className="m-0 type-label text-ink">{t`Taalcut couldn’t check on your imports`}</p>
      <div className="flex flex-wrap items-center gap-3">
        <ErrorLine error={error} className="min-w-0 flex-1" />
        <Button size="sm" variant="secondary" icon={VERB_ICONS.retry} onClick={onRetry}>
          {t`Try again`}
        </Button>
      </div>
    </div>
  );
}

/** Bones in the line's shape while the status is late: a mark, the words, and the bar under them. */
function StripBones() {
  const { t } = useLingui();
  return (
    <div data-slot="import-strip" data-state="loading" aria-busy className="flex items-center gap-3">
      <span className="sr-only" role="status">
        {t`Checking on your imports`}
      </span>
      <span aria-hidden className="tc-bone block size-4 shrink-0 rounded-pill bg-hover" />
      <div aria-hidden className="flex flex-1 flex-col gap-2">
        <span className="tc-bone block h-4 w-2/5 rounded-sm bg-hover" />
        <span className="tc-bone block h-1 w-32 rounded-pill bg-hover" />
      </div>
    </div>
  );
}
