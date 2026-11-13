// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An import's failed files, for its strip (UX1-IMPORT): what they are (so the line says "2 videos"), and, while
 * See which is open, each file with why it failed in words. Leave them out asks for the files that couldn't be
 * read (a reading stage failed), never clips that play but whose analysis didn't finish.
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  type AssetDetail,
  type AssetId,
  type AssetKind,
  type AssetSummary,
  type Result,
  type SourceId,
  type TaalcutError,
} from '@taalcut/core';
import { failureReason, READING_STAGES } from '@taalcut/ui';
import { useCallback, useEffect, useState } from 'react';
import { useBackend } from '../../backend/backend';

/** Files listed with their reasons; the rest are counted. */
export const LISTED = 8;
/** Leave them out takes at most this many in one go (the trash command's limit). */
const LEAVE_MAX = 1000;

export interface FailedFileRow {
  readonly id: AssetId;
  readonly kind: AssetKind;
  readonly name: string;
  readonly reason: string;
  /** A reading stage failed: the file couldn't be read. */
  readonly unreadable: boolean;
}

export interface FailedFiles {
  /** The failed files by kind (of the first page), once known. */
  readonly kinds: Partial<Record<AssetKind, number>> | undefined;
  /** Each listed file and why, while open. */
  readonly rows: readonly FailedFileRow[];
  readonly total: number;
  readonly loading: boolean;
  readonly error: TaalcutError | null;
  readonly reload: () => void;
}

type Backend = ReturnType<typeof useBackend>;

function browseFailed(
  backend: Backend,
  sourceId: SourceId,
  limit: number,
  cursor?: string,
  signal?: AbortSignal,
) {
  return callRpc(
    backend.library.browse(
      {
        filters: { sourceIds: [sourceId], indexStates: ['failed'] },
        // Newest first: the files this import just brought in, then older clips of the source.
        sort: 'added',
        direction: 'desc',
        limit,
        ...(cursor ? { cursor } : {}),
      },
      signal ? { signal } : undefined,
    ),
  );
}

/** The stage that failed, from the asset's detail. */
const failedStage = (detail: AssetDetail) => detail.stages.find((stage) => stage.state === 'failed');

/** Reads `failed` failed files of one source; their reasons only while `open`. */
export function useFailedFiles(sourceId: SourceId, failed: number, open: boolean): FailedFiles {
  const backend = useBackend();
  const { i18n } = useLingui();
  const [state, setState] = useState<Omit<FailedFiles, 'reload'>>({
    kinds: undefined,
    rows: [],
    total: 0,
    loading: false,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (failed === 0) return;
    const controller = new AbortController();
    const { signal } = controller;
    setState((now) => ({ ...now, loading: open, error: null }));
    void (async () => {
      const page = await browseFailed(backend, sourceId, open ? LISTED : 60, undefined, signal);
      if (signal.aborted) return;
      if (!page.ok) return setState((now) => ({ ...now, loading: false, error: page.error }));
      const kinds = countKinds(page.value.items);
      if (!open) return setState({ kinds, rows: [], total: page.value.total, loading: false, error: null });
      const rows = await Promise.all(page.value.items.map((item) => rowOf(backend, i18n, item, signal)));
      if (signal.aborted) return;
      const broken = rows.find((row): row is Extract<typeof row, { ok: false }> => !row.ok);
      if (broken) return setState((now) => ({ ...now, loading: false, error: broken.error }));
      const listed = rows.flatMap((row) => (row.ok ? [row.value] : []));
      setState({ kinds, rows: listed, total: page.value.total, loading: false, error: null });
    })();
    return () => controller.abort();
  }, [backend, i18n, sourceId, failed, open, attempt]);

  return { ...state, reload };
}

function countKinds(items: readonly AssetSummary[]): Partial<Record<AssetKind, number>> {
  const kinds: Partial<Record<AssetKind, number>> = {};
  for (const item of items) kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;
  return kinds;
}

async function rowOf(
  backend: Backend,
  i18n: ReturnType<typeof useLingui>['i18n'],
  item: AssetSummary,
  signal: AbortSignal,
): Promise<Result<FailedFileRow>> {
  const detail = await callRpc(backend.library.asset({ assetId: item.id }, { signal }));
  if (!detail.ok) return detail;
  const stage = failedStage(detail.value);
  const name = stage?.stage ?? 'library.hash';
  return {
    ok: true,
    value: {
      id: item.id,
      kind: item.kind,
      name: item.name,
      reason: failureReason(i18n, name, stage?.error),
      unreadable: READING_STAGES.includes(name),
    },
  };
}

/**
 * The source's files that couldn't be read, for Leave them out. When every failure is a file that couldn't be
 * read the failed filter is the answer; otherwise each file's detail says which stage failed.
 */
export async function unreadableIds(
  backend: Backend,
  sourceId: SourceId,
  onlyUnreadable: boolean,
): Promise<Result<AssetId[]>> {
  const ids: AssetId[] = [];
  let cursor: string | undefined;
  do {
    const page = await browseFailed(backend, sourceId, 200, cursor);
    if (!page.ok) return page;
    ids.push(...page.value.items.map((item) => item.id));
    cursor = page.value.nextCursor;
  } while (cursor && ids.length < LEAVE_MAX);
  if (onlyUnreadable) return { ok: true, value: ids.slice(0, LEAVE_MAX) };
  const kept: AssetId[] = [];
  for (const assetId of ids.slice(0, LEAVE_MAX)) {
    const detail = await callRpc(backend.library.asset({ assetId }));
    if (!detail.ok) return detail;
    const stage = failedStage(detail.value);
    if (stage && READING_STAGES.includes(stage.stage)) kept.push(assetId);
  }
  return { ok: true, value: kept };
}
