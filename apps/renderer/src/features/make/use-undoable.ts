// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A command from the Make pages (rename, archive, restore a version, delete
 * an export), dispatched on the bus as the user, one idempotency key per
 * press. Done: a toast says what changed, with Undo, which is the project's
 * ⌘Z (an app-wide command's, such as a look applied to many videos: the app-wide history). Failed: a toast
 * with the cause. `undone` reads what the undo answered (contract-3 §2: a batch's undo lists videos changed since).
 */
import { useLingui } from '@lingui/react/macro';
import { callRpc, newId, type ProjectId, type Result } from '@taalcut/core';
import { errorMessage, toast } from '@taalcut/ui';
import { useCallback, useState, type ReactNode } from 'react';
import { useBackend } from '../../backend/backend';

/** The project's Undo (core's edit.undo): ⌘Z on a Mac, Ctrl+Z elsewhere; shown with useShortcutFormat. */
export const UNDO_SHORTCUT = 'mod+z';

export interface UndoableRequest {
  readonly name: string;
  readonly payload: unknown;
  /** Whose history the command joins (null: app-wide): the toast's Undo undoes the latest change there. */
  readonly projectId: ProjectId | null;
  /** A longer line under `done`, made from the command's result (what was skipped, and why). */
  readonly detail?: (result: unknown) => ReactNode;
  /** After the toast's Undo: the undo receipt's `result`, for a follow-up line. */
  readonly undone?: (result: unknown) => void;
  /** What happened, translated: "Archived Golden hour market" (a name inside UserContent); or made from the result. */
  readonly done: ReactNode | ((result: unknown) => ReactNode);
  /** What failed, translated: "Couldn’t archive the project". */
  readonly failed: string;
}

export function useUndoable(): {
  run: (request: UndoableRequest) => Promise<Result<unknown>>;
  pending: boolean;
} {
  const backend = useBackend();
  const { t, i18n } = useLingui();
  const [pending, setPending] = useState(0);
  const run = useCallback(
    async (request: UndoableRequest) => {
      setPending((n) => n + 1);
      try {
        const result = await callRpc(
          backend.commands.dispatch({
            name: request.name,
            payload: request.payload,
            source: 'ui',
            idempotencyKey: newId(),
          }),
        );
        if (!result.ok) {
          toast({ tone: 'danger', title: request.failed, description: errorMessage(i18n, result.error) });
          return result;
        }
        const { done, detail } = request;
        const description = detail?.(result.value.result);
        toast({
          title: typeof done === 'function' ? done(result.value.result) : done,
          ...(description ? { description } : {}),
          action: {
            label: t`Undo`,
            onSelect: () =>
              void callRpc(backend.commands.undo({ projectId: request.projectId, source: 'ui' })).then(
                (undone) => {
                  if (!undone.ok)
                    toast({
                      tone: 'danger',
                      title: t`Couldn’t undo that`,
                      description: errorMessage(i18n, undone.error),
                    });
                  else request.undone?.(undone.value?.result);
                },
              ),
          },
        });
        return result;
      } finally {
        setPending((n) => n - 1);
      }
    },
    [backend, t, i18n],
  );
  return { run, pending: pending > 0 };
}
