// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What Settings → Memory does (LRN1-MEM), each through the command bus as the person, as ⌘K and the agent do:
 * add an item for every video, a project or a template (`memory.create`), change an item's words or move it to
 * another scope (`memory.update`, naming the revision it read), delete one (`memory.delete`: the toast's Undo puts it
 * back) and the cloud switch (`memory.setCloudPrompts`: the person's, never undone). A scope the item can't take
 * (core's memoryItemProblems) is refused before anything is sent. Add and edit say why they failed under their
 * field; a deletion says so in its toast.
 * Each row's editor, busy state and error, and its save and delete, are the rows' one-at-a-time step
 * (use-row-changes.ts), which LRN1-PREF's casting weights use for their Save and Reset too (use-casting-weights.ts).
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  MEMORY_COMMANDS,
  newId,
  ValidationError,
  type MemoryItemView,
  type MemoryScope,
  type TaalcutError,
} from '@taalcut/core';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { sameScope, scopeProblems } from './memory-scope';
import { useRowChanges } from './use-row-changes';

/** The item can't go there: core's first reason, as a validation error on the scope. */
function refused(problems: readonly string[]): TaalcutError | null {
  const problem = problems[0];
  return problem === undefined ? null : ValidationError({ field: 'scope' }, { detail: problem });
}

export function useMemoryActions() {
  const { t } = useLingui();
  const backend = useBackend();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<TaalcutError | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState<TaalcutError | null>(null);

  const dispatch = (name: string, payload: unknown) =>
    callRpc(backend.commands.dispatch({ name, payload, source: 'ui', idempotencyKey: newId() }));
  const rows = useRowChanges(dispatch);

  /** Resolves true once the item is remembered (the field then clears). */
  const add = async (text: string, scope: MemoryScope): Promise<boolean> => {
    const problem = refused(scopeProblems({ source: 'user', data: null, conversationId: null }, scope));
    setAddError(problem);
    if (problem) return false;
    setAdding(true);
    const created = await dispatch(MEMORY_COMMANDS.create, {
      memoryId: newId<'MemoryItem'>(),
      item: { scope, text, source: 'user' },
    });
    setAdding(false);
    if (!created.ok) setAddError(created.error);
    return created.ok;
  };

  /** The words and the scope, each sent only when it changed; nothing changed closes the editor. */
  const save = async (item: MemoryItemView, text: string, scope: MemoryScope) => {
    const moved = !sameScope(scope, item.scope);
    if (text === item.text && !moved) return rows.cancel();
    const problem = refused(moved ? scopeProblems(item, scope) : []);
    if (problem) return rows.refuse(item.id, problem);
    await rows.saveItem(item, { ...(text === item.text ? {} : { text }), ...(moved ? { scope } : {}) });
  };

  const remove = (item: MemoryItemView) =>
    rows.deleteItem(item, {
      done: t`Deleted from memory`,
      detail: () => t`New chats won’t use it.`,
      failed: t`Couldn’t delete that`,
    });

  const setCloudPrompts = async (enabled: boolean) => {
    setCloudError(null);
    setCloudBusy(true);
    const set = await dispatch(MEMORY_COMMANDS.setCloudPrompts, { enabled });
    setCloudBusy(false);
    if (!set.ok) setCloudError(set.error);
  };

  return {
    add,
    adding,
    addError,
    clearAddError: () => setAddError(null),
    ...rows,
    save,
    remove,
    setCloudPrompts,
    cloudBusy,
    cloudError,
  };
}

export type MemoryActions = ReturnType<typeof useMemoryActions>;
