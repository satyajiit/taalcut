// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings › Sources' data: the library's sources (`library.sources`) and the
 * import running in each (`indexing.status`), kept current from the bus. A
 * command that changes a source (from this page, ⌘K, the agent or an undo)
 * arrives as `command.changed`; a scan that finds or loses clips as
 * `library.changed`; import progress as `library.indexing`. Bursts of changes
 * during an import re-read the list at most once a second.
 */
import { callRpc, type ImportStatus, type IndexingStatus, type SourceId } from '@taalcut/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery } from '../../../backend/use-rpc';

/** The commands that change what `library.sources` answers. */
const SOURCE_COMMANDS = new Set([
  'library.addSource',
  'library.removeSource',
  'library.renameSource',
  'library.setSourceWatch',
  'library.rescanSource',
  'library.relinkLocations',
  'library.restoreLocations',
]);
const SETTLE_MS = 1_000;

/** Calls `reload` at most once per `ms`, the last call in a burst always landing. */
function useCoalesced(reload: () => void, ms: number): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      reloadRef.current();
    }, ms);
  }, [ms]);
}

export function useSources() {
  const backend = useBackend();
  const sources = useRpcQuery((signal) => backend.library.sources(undefined, { signal }), [backend]);
  const soon = useCoalesced(sources.reload, SETTLE_MS);

  const [indexing, setIndexing] = useState<IndexingStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void callRpc(backend.indexing.status(undefined, { signal: controller.signal })).then((result) => {
      // Without it a row says less (no "Reading 40 of 120 clips"), never something wrong.
      if (result.ok) setIndexing(result.value);
    });
    return () => controller.abort();
  }, [backend]);

  useBackendEvents(['command.changed', 'library.changed', 'library.indexing'], (event) => {
    if (event.type === 'library.indexing') {
      setIndexing(event.payload);
      return;
    }
    if (event.type === 'command.changed') {
      // This page's own changes show at once; the rest settle first.
      if (SOURCE_COMMANDS.has(event.payload.name)) sources.reload();
      return;
    }
    if (event.payload.entity === 'source') sources.reload();
    else if (event.payload.entity === 'asset') soon();
  });

  const importOf = useCallback(
    (sourceId: SourceId): ImportStatus | undefined =>
      indexing?.sources.find((entry) => entry.sourceId === sourceId),
    [indexing],
  );
  return { sources, importOf };
}
