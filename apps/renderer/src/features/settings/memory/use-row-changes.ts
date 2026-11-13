// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Memory's rows, one change at a time (LRN1-MEM's items and LRN1-PREF's casting weights): which row's
 * editor is open, which row is busy and with what, and why its last change failed. A save (`memory.update`, naming
 * the revision it read) and a delete (`memory.delete` through the undoable runner, whose toast says whether it failed
 * and whose Undo puts the item back) each hold the rows: the row is busy and the others wait, a failed save shows
 * under its row, and a save that lands closes the editor.
 */
import {
  MEMORY_COMMANDS,
  type AsyncResult,
  type MemoryId,
  type MemoryItem,
  type MemoryItemView,
  type TaalcutError,
} from '@taalcut/core';
import type { MemoryItemBusy } from '@taalcut/ui';
import { useState } from 'react';
import { useUndoable, type UndoableRequest } from '../../make/use-undoable';

type RowAction = Exclude<MemoryItemBusy, null>;

/** The page's dispatch: one command on the bus as the person. */
export type MemoryDispatch = (name: string, payload: unknown) => AsyncResult<unknown>;

/** What a save changes: only what differs from the revision it read. */
export type MemoryPatch = Partial<Pick<MemoryItem, 'scope' | 'text' | 'data'>>;

/** What a deletion's toast says. */
export type DeletionWords = Pick<UndoableRequest, 'done' | 'detail' | 'failed'>;

export function useRowChanges(dispatch: MemoryDispatch) {
  const undoable = useUndoable();
  const [editing, setEditing] = useState<MemoryId | null>(null);
  const [busy, setBusy] = useState<{ id: MemoryId; action: RowAction } | null>(null);
  const [rowError, setRowError] = useState<{ id: MemoryId; error: TaalcutError } | null>(null);

  /** One row's change: `work` resolves to why it failed (null: it didn't). */
  const hold = async (id: MemoryId, action: RowAction, work: () => Promise<TaalcutError | null>) => {
    setRowError(null);
    setBusy({ id, action });
    const error = await work();
    setBusy(null);
    if (error) setRowError({ id, error });
    else if (action === 'save') setEditing(null);
  };

  const saveItem = (item: MemoryItemView, patch: MemoryPatch) =>
    hold(item.id, 'save', async () => {
      const payload = { memoryId: item.id, baseRevision: item.revision, patch };
      const saved = await dispatch(MEMORY_COMMANDS.update, payload);
      return saved.ok ? null : saved.error;
    });

  // The toast says whether the deletion failed, so the row shows nothing.
  const deleteItem = (item: MemoryItemView, words: DeletionWords) =>
    hold(item.id, 'delete', async () => {
      await undoable.run({
        name: MEMORY_COMMANDS.remove,
        payload: { memoryId: item.id },
        projectId: null,
        ...words,
      });
      return null;
    });

  return {
    editing,
    edit: (id: MemoryId) => {
      setRowError(null);
      setEditing(id);
    },
    cancel: () => {
      setRowError(null);
      setEditing(null);
    },
    /** Says under the row why a change was refused before anything was sent. */
    refuse: (id: MemoryId, error: TaalcutError) => setRowError({ id, error }),
    saveItem,
    deleteItem,
    busyOf: (id: MemoryId): MemoryItemBusy => (busy?.id === id ? busy.action : null),
    anyBusy: busy !== null,
    errorOf: (id: MemoryId) => (rowError?.id === id ? rowError.error : null),
  };
}
