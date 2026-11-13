// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: one source's import in the library's strip · genre: atmospheric studio app
 *   (chrome modern-minimal) · system: DESIGN.md v0.3
 * states: the view's (ui ImportProgressView, strip variant); failed files: the line names them by kind, See which
 *   opens the failed filter with each file and why (ImportFailedList: loading bones, error with Try again), Show all
 *   clips closes it, Try again retries this source only, Leave them out moves the files that couldn't be read to
 *   the trash (a toast with Undo); waiting: what for, with See models; stopped: why (its scan's error)
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  LIBRARY_COMMANDS,
  type ImportStatus,
  type IndexingStatus,
  type SourceView,
  type TaalcutError,
} from '@taalcut/core';
import {
  ImportFailedList,
  importFailures,
  ImportProgressView,
  UserContent,
  type ImportAction,
} from '@taalcut/ui';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useId } from 'react';
import { useBackend } from '../../backend/backend';
import { useUndoable } from '../make/use-undoable';
import { unreadableIds, useFailedFiles } from './import-failed';

interface Props {
  readonly status: ImportStatus;
  readonly source: SourceView | undefined;
  readonly pending: ImportAction | null;
  readonly setPending: (next: ImportAction | null) => void;
  readonly setError: (error: TaalcutError | null) => void;
  readonly setStatus: (next: IndexingStatus) => void;
  readonly onSeeFailed: () => void;
  /** Only what the import line above doesn't say (one import): its failed files, its waits, why it stopped. */
  readonly extrasOnly?: boolean;
}

export function ImportStripSource({
  status,
  source,
  pending,
  setPending,
  setError,
  setStatus,
  ...props
}: Props) {
  const { t } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const listId = useId();
  const undoable = useUndoable();
  // See which opens the library's failed filter; while it is on, the strip lists each file and why.
  const search: { filter?: unknown } = useSearch({ strict: false });
  const open = search.filter === 'failed';
  const failures = importFailures(status);
  const files = useFailedFiles(status.sourceId, status.counts.failed, open);

  const act = (kind: 'pause' | 'resume') => async () => {
    setPending(kind);
    setError(null);
    const result = await callRpc(kind === 'pause' ? backend.indexing.pause() : backend.indexing.resume());
    setPending(null);
    if (!result.ok) return setError(result.error);
    setStatus(result.value);
  };

  /** Try again, for this source's files only; the status event brings the change. */
  const retry = async () => {
    setPending('retry');
    setError(null);
    const result = await callRpc(backend.indexing.retryFailed({ sourceId: status.sourceId }));
    setPending(null);
    if (!result.ok) setError(result.error);
  };

  const leaveOut = async () => {
    setPending('leave');
    setError(null);
    const ids = await unreadableIds(backend, status.sourceId, failures.unanalysed === 0);
    if (!ids.ok) {
      setPending(null);
      return setError(ids.error);
    }
    const count = ids.value.length;
    if (count > 0)
      await undoable.run({
        name: LIBRARY_COMMANDS.trashAssets,
        payload: { assetIds: ids.value },
        projectId: null,
        done: t`${plural(count, { one: 'Left # file out of your library', other: 'Left # files out of your library' })}`,
        failed: t`Couldn’t leave the files out`,
      });
    setPending(null);
  };

  const name = source?.name;
  return (
    <ImportProgressView
      variant="strip"
      extrasOnly={props.extrasOnly ?? false}
      status={status}
      source={name ? <UserContent translate="no">{name}</UserContent> : t`your footage`}
      pending={pending}
      onPause={act('pause')}
      onResume={act('resume')}
      onRetry={() => void retry()}
      onSeeFailed={props.onSeeFailed}
      failedOpen={open}
      onHideFailed={() =>
        void navigate({ to: '.', search: (prev: object) => ({ ...prev, filter: undefined }), replace: true })
      }
      failedListId={listId}
      failedList={
        <ImportFailedList
          id={listId}
          files={files.rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            name: <UserContent translate="no">{row.name}</UserContent>,
            reason: row.reason,
          }))}
          more={Math.max(0, files.total - files.rows.length)}
          loading={files.loading}
          error={files.error}
          onRetry={files.reload}
        />
      }
      {...(failures.unanalysed === 0 && files.kinds ? { failedKinds: files.kinds } : {})}
      onLeaveOut={() => void leaveOut()}
      waitingFor={source?.status === 'offline' ? 'originals' : 'model'}
      onOpenModels={() => void navigate({ to: '/settings/models' })}
      stoppedBecause={source?.scan.error ?? null}
    />
  );
}
