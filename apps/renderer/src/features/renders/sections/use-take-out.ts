// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A part the export section can take out (the voiceover, the hits on the cuts) and put back. Taking out is the
 * part's own command, with a toast and Undo (useUndoable; a failure is its toast); putting back is that undo, run
 * only while the take-out is still the newest change in the project's history, so it never undoes something else.
 */
import { callRpc, type ProjectId, type TaalcutError } from '@taalcut/core';
import { useState, type ReactNode } from 'react';
import { useBackend } from '../../../backend/backend';
import { useUndoable } from '../../make/use-undoable';

export interface TakeOutRequest {
  readonly name: string;
  readonly payload: unknown;
  readonly done: ReactNode;
  readonly failed: string;
}

export function useTakeOut(projectId: ProjectId) {
  const backend = useBackend();
  const { run } = useUndoable();
  const [pending, setPending] = useState<'out' | 'back' | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  /** Whether "put back" can still undo it (false once something newer happened). */
  const [canPutBack, setCanPutBack] = useState(true);

  const out = async (request: TakeOutRequest): Promise<boolean> => {
    setPending('out');
    setError(null);
    const result = await run({ ...request, projectId });
    setPending(null);
    setCanPutBack(result.ok);
    return result.ok;
  };
  const back = async (name: string): Promise<boolean> => {
    setPending('back');
    setError(null);
    try {
      const history = await callRpc(backend.commands.history({ projectId }));
      if (!history.ok) {
        setError(history.error);
        return false;
      }
      if (history.value.undo !== name) {
        setCanPutBack(false);
        return false;
      }
      const undone = await callRpc(backend.commands.undo({ projectId, source: 'ui' }));
      if (!undone.ok) setError(undone.error);
      return undone.ok;
    } finally {
      setPending(null);
    }
  };
  return { out, back, pending, error, canPutBack };
}
