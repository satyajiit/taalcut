// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { ValidationError } from '../basics/errors';
import { newId, ulidSchema, type ProjectId } from '../basics/ids';
import { err, ok, type AsyncResult } from '../basics/result';
import type { DispatchReceipt, HistoryReceipt, HistoryStepOptions } from './bus-types';
import type { CommandOrigin } from './definition';

/** Native queue operations: never dispatched recursively from a command handler. */
export const HISTORY_COMMANDS = { undo: 'history.undo', redo: 'history.redo' } as const;
export const historyMutationSchema = z.object({
  projectId: ulidSchema('Project'),
  /** Read from history.get. A repeat or stale request cannot undo another change. */
  expectedCommandId: ulidSchema('Command'),
  expectedHistoryToken: ulidSchema('Command'),
});
export const historyStateJsonSchema = z.object({
  token: ulidSchema('Command').optional(),
  undo: z.string().nullable(),
  redo: z.string().nullable(),
  undoId: ulidSchema('Command').nullable().optional(),
  redoId: ulidSchema('Command').nullable().optional(),
  undoGroup: z.string().nullable().optional(),
  redoGroup: z.string().nullable().optional(),
});

type Step = (
  project: ProjectId | null,
  origin: CommandOrigin,
  options?: HistoryStepOptions,
) => AsyncResult<HistoryReceipt | null>;
export async function dispatchHistory(
  name: string,
  payload: unknown,
  origin: CommandOrigin,
  step: Step,
): AsyncResult<DispatchReceipt> {
  const parsed = historyMutationSchema.safeParse(payload);
  if (!parsed.success) return err(ValidationError({ field: 'history' }));
  const done = await step(parsed.data.projectId, origin, {
    expectedCommandId: parsed.data.expectedCommandId,
    expectedHistoryToken: parsed.data.expectedHistoryToken,
  });
  if (!done.ok) return done;
  return ok({
    id: done.value?.id ?? newId<'Command'>(),
    name,
    projectId: parsed.data.projectId,
    sequence: null,
    result: done.value,
    undoable: false,
    deduplicated: false,
  });
}
