// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What Settings › Sources does to the library, each through the command bus as
 * the user, as ⌘K and the agent do: add a folder (main's folder dialog, then
 * `library.addSource`), remove one (`library.removeSource`, undoable: the
 * toast's Undo puts it back with its clips' analysis), watch it or not
 * (`library.setSourceWatch`) and look through it again (`library.rescanSource`).
 * A failed add says why under the button; a failed row action says why in its row.
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  LIBRARY_COMMANDS,
  newId,
  type SourceId,
  type SourceView,
  type TaalcutError,
} from '@taalcut/core';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useUndoable } from '../../make/use-undoable';

export type RowAction = 'remove' | 'watch' | 'rescan';

export function useSourceActions() {
  const { t } = useLingui();
  const backend = useBackend();
  const undoable = useUndoable();
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<TaalcutError | null>(null);
  /** The row whose action is on its way, and which one. */
  const [busy, setBusy] = useState<{ id: SourceId; action: RowAction } | null>(null);
  const [rowError, setRowError] = useState<{ id: SourceId; error: TaalcutError } | null>(null);

  const dispatch = (name: string, payload: unknown) =>
    callRpc(backend.commands.dispatch({ name, payload, source: 'ui', idempotencyKey: newId() }));

  /** Opens the folder dialog; a cancelled dialog changes nothing. Resolves true when a folder was added. */
  const addFolder = async (): Promise<boolean> => {
    setAddError(null);
    setPicking(true);
    const picked = await callRpc(backend.files.pickFolder());
    setPicking(false);
    if (!picked.ok) {
      setAddError(picked.error);
      return false;
    }
    if (!picked.value) return false;
    setAdding(true);
    const added = await dispatch(LIBRARY_COMMANDS.addSource, { path: picked.value.path });
    setAdding(false);
    if (!added.ok) setAddError(added.error);
    return added.ok;
  };

  const run = async (source: SourceView, action: RowAction, step: () => Promise<boolean>) => {
    setRowError(null);
    setBusy({ id: source.id, action });
    await step();
    setBusy(null);
  };

  const remove = (source: SourceView) =>
    run(source, 'remove', async () => {
      const name = source.name;
      const removed = await undoable.run({
        name: LIBRARY_COMMANDS.removeSource,
        payload: { sourceId: source.id },
        projectId: null,
        done: t`Removed ${name}`,
        detail: () => t`Its clips left your library. The files stay where they are.`,
        failed: t`Couldn’t remove ${name}`,
      });
      return removed.ok;
    });

  const rowStep = (source: SourceView, action: RowAction, name: string, payload: unknown) =>
    run(source, action, async () => {
      const result = await dispatch(name, payload);
      if (!result.ok) setRowError({ id: source.id, error: result.error });
      return result.ok;
    });

  const setWatch = (source: SourceView, watch: boolean) =>
    rowStep(source, 'watch', LIBRARY_COMMANDS.setSourceWatch, { sourceId: source.id, watch });

  const rescan = (source: SourceView) =>
    rowStep(source, 'rescan', LIBRARY_COMMANDS.rescanSource, { sourceId: source.id });

  return {
    addFolder,
    /** The dialog is open or the folder is being added. */
    adding: picking || adding,
    addError,
    clearAddError: () => setAddError(null),
    remove,
    setWatch,
    rescan,
    busyOf: (id: SourceId) => (busy?.id === id ? busy.action : null),
    errorOf: (id: SourceId) => (rowError?.id === id ? rowError.error : null),
  };
}

export type SourceActions = ReturnType<typeof useSourceActions>;
