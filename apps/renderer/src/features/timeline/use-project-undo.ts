// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The open project's undo and redo for the editor's own buttons (UX4): what the next undo and redo would reverse
 * (the bus's history, read again after every change), and the way to run them. The same history ⌘Z, the menu and
 * ⌘K use (shell/current-project), so the buttons and the keys never disagree.
 */
import { AGENT_TURN_GROUP_PREFIX, callRpc, type ProjectId } from '@taalcut/core';
import { errorMessage, toast } from '@taalcut/ui';
import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';

export interface ProjectUndo {
  /** The command the next undo reverses, or null with nothing to undo. */
  readonly undo: string | null;
  readonly redo: string | null;
  /** EDT1: the next undo (redo) takes back (applies again) a whole turn of the chat's changes. */
  readonly undoTurn: boolean;
  readonly redoTurn: boolean;
  readonly busy: 'undo' | 'redo' | null;
  run(which: 'undo' | 'redo'): Promise<void>;
}

const isTurn = (group: string | null | undefined) => !!group?.startsWith(AGENT_TURN_GROUP_PREFIX);

export function useProjectUndo(projectId: ProjectId): ProjectUndo {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const [changes, setChanges] = useState(0);
  useBackendEvents(['command.changed'], () => setChanges((n) => n + 1));
  const history = useRpcQuery(
    (signal) => backend.commands.history({ projectId }, { signal }),
    [backend, projectId, changes],
  );
  const [busy, setBusy] = useState<'undo' | 'redo' | null>(null);
  return {
    undo: history.data?.undo ?? null,
    redo: history.data?.redo ?? null,
    undoTurn: isTurn(history.data?.undoGroup),
    redoTurn: isTurn(history.data?.redoGroup),
    busy,
    async run(which) {
      setBusy(which);
      const result = await callRpc(
        which === 'undo'
          ? backend.commands.undo({ projectId, source: 'ui' })
          : backend.commands.redo({ projectId, source: 'ui' }),
      );
      setBusy(null);
      history.reload();
      if (!result.ok)
        toast({
          tone: 'danger',
          title: which === 'undo' ? t`Couldn’t undo` : t`Couldn’t redo`,
          description: errorMessage(i18n, result.error),
        });
    },
  };
}
