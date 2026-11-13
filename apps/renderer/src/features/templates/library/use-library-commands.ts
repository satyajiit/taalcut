// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's writes (P3-V14): one or more commands on the bus as the person ('ui'), one idempotency key each.
 * Done: a toast says what changed, with Undo, which undoes every step it took (tagging five templates is five
 * template.setTags, so five undos; a move or an import is one). Failed: a toast with the cause, in the library's
 * words; what already ran stays, and the toast says so.
 */
import { useLingui } from '@lingui/react/macro';
import { callRpc, err, newId, ok, type Result } from '@taalcut/core';
import { toast } from '@taalcut/ui';
import { useCallback, useState, type ReactNode } from 'react';
import { useBackend } from '../../../backend/backend';
import type { CommandRequest } from '../../../backend/use-command';
import { libraryErrorText } from './library-words';

export interface LibraryWrite {
  readonly steps: readonly CommandRequest[];
  /** What happened, translated (names inside UserContent). */
  readonly done: ReactNode;
  /** What failed, translated: "Couldn’t move the templates". */
  readonly failed: string;
  /** Show the toast (false when the caller says it its own way, as an inline error). */
  readonly toast?: boolean;
}

export function useLibraryCommands() {
  const backend = useBackend();
  const { t, i18n } = useLingui();
  const [pending, setPending] = useState(0);

  const undo = useCallback(
    async (steps: number) => {
      for (let step = 0; step < steps; step += 1) {
        const undone = await callRpc(backend.commands.undo({ projectId: null, source: 'ui' }));
        if (!undone.ok) {
          toast({
            tone: 'danger',
            title: t`Couldn’t undo that`,
            description: libraryErrorText(i18n, undone.error),
          });
          return;
        }
      }
    },
    [backend, t, i18n],
  );

  const run = useCallback(
    async (write: LibraryWrite): Promise<Result<readonly unknown[]>> => {
      setPending((n) => n + 1);
      const results: unknown[] = [];
      try {
        for (const step of write.steps) {
          const receipt = await callRpc(
            backend.commands.dispatch({ ...step, source: 'ui', idempotencyKey: newId() }),
          );
          if (!receipt.ok) {
            if (write.toast !== false) {
              const ran = results.length;
              toast({
                tone: 'danger',
                title: write.failed,
                description: libraryErrorText(i18n, receipt.error),
                ...(ran > 0
                  ? { action: { label: t`Undo what changed`, onSelect: () => void undo(ran) } }
                  : {}),
              });
            }
            return err(receipt.error);
          }
          results.push(receipt.value.result);
        }
        if (write.toast !== false)
          toast({
            title: write.done,
            action: { label: t`Undo`, onSelect: () => void undo(write.steps.length) },
          });
        return ok(results);
      } finally {
        setPending((n) => n - 1);
      }
    },
    [backend, t, i18n, undo],
  );

  return { run, undo, pending: pending > 0 };
}
