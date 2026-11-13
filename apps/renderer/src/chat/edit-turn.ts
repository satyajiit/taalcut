// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the changes card does in the app (EDT1-CTX): "Undo all" and "Redo" take its turn back or apply it again
 * whole, as the command group it is (the bus refuses when the turn isn't next: a conflict the card shows); its
 * status follows the project's history, read again after every change; a row opens its item in the editor, the
 * playhead on it (from the full chat, the editor opens on that video first); HFW1-UI: a design row's View files opens
 * the editor's Files at that graphic's design.
 */
import { callRpc, type EditTarget, type ProjectId, type TimelineItemId } from '@taalcut/core';
import type { CardEditTurn, EditTurnStatus } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useBackend } from '../backend/backend';
import { useBackendEvents } from '../backend/use-events';
import { useRpcQuery } from '../backend/use-rpc';
import { focusInEditor } from '../features/timeline/open-editor';
import { showFiles } from '../features/timeline/workspace/files-requests';
import { navigateCardLink } from './card-links';

/** What the history says of a group: the next undo, the next redo, or neither. */
export interface GroupHistory {
  readonly undoGroup?: string | null;
  readonly redoGroup?: string | null;
}

/**
 * The turn's status from the history and what this window saw of it last. Neither next undo nor next redo: later
 * changes sit on top of it, unless it was undone here and something else changed since, which drops its redo (no
 * buttons then: nothing can bring it back).
 */
export function turnStatus(
  history: GroupHistory | undefined,
  group: string,
  seen: EditTurnStatus | undefined,
): EditTurnStatus {
  if (!history) return seen ?? 'unknown';
  if (history.undoGroup === group) return 'applied';
  if (history.redoGroup === group) return 'undone';
  return seen === 'undone' || seen === 'unknown' ? 'unknown' : 'later';
}

/** Each turn's status as this window last saw it, so a dropped redo isn't taken for later changes. */
const seen = new Map<string, EditTurnStatus>();

function useTurnStatus(projectId: ProjectId, group: string): EditTurnStatus {
  const backend = useBackend();
  const [changes, setChanges] = useState(0);
  useBackendEvents(['command.changed'], () => setChanges((n) => n + 1));
  const history = useRpcQuery(
    (signal) => backend.commands.history({ projectId }, { signal }),
    [backend, projectId, changes],
  );
  const status = turnStatus(history.data, group, seen.get(group));
  useEffect(() => {
    if (history.data) seen.set(group, status);
  }, [group, status, history.data]);
  return status;
}

/** Forget what this window saw (tests). */
export function resetTurnStatusForTests(): void {
  seen.clear();
}

export function useEditTurn(): CardEditTurn {
  const backend = useBackend();
  const navigate = useNavigate();
  return useMemo<CardEditTurn>(
    () => ({
      useStatus: useTurnStatus,
      undo: (projectId, group) => callRpc(backend.commands.undo({ projectId, source: 'ui', group })),
      redo: (projectId, group) => callRpc(backend.commands.redo({ projectId, source: 'ui', group })),
      open(projectId, target: EditTarget, at) {
        if (focusInEditor(target, at)) return;
        // The editor isn't on that video: open it there; it takes the focus when it is up.
        navigateCardLink(navigate, { to: 'timeline', projectId, timelineId: target.timelineId });
      },
      // HFW1-UI: a design row's View files: the dock's Files at that graphic's design (the editor first, if need be).
      openFiles(projectId, target: EditTarget) {
        const itemId = target.kind === 'item' ? (target.itemId as TimelineItemId) : null;
        showFiles({ timelineId: target.timelineId, itemId });
        if (!focusInEditor(target, null))
          navigateCardLink(navigate, { to: 'timeline', projectId, timelineId: target.timelineId });
      },
    }),
    [backend, navigate],
  );
}
