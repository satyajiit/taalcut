// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type CreationTask,
  type ProjectId,
  type Result,
} from '@taalcut/core';
import type { z } from 'zod';
import { CreationBudgetExceeded, CreationInterruptedCharge, CreationOutputInvalid } from './errors';
import type { CreationDirectorDeps, CreationModelRequest } from './ports';
import type { CreationState } from './state';

/** One director plus five admitted specialists. A local model's own job lane may lower actual concurrency. */
export function creationWorkerPool() {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= 5) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

export function parseCreationJson(text: string): unknown {
  return JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, ''),
  );
}

export function creationTasks(
  deps: CreationDirectorDeps,
  state: CreationState,
  projectId: ProjectId,
  signal: AbortSignal,
  pool = creationWorkerPool(),
) {
  async function execute<T>(
    key: string,
    role: CreationTask['role'],
    revision: number,
    parse: (value: unknown) => Result<T>,
    work: (task: CreationTask) => AsyncResult<T>,
  ): AsyncResult<T> {
    const found = await state.task(projectId, key, role, revision);
    if (!found.ok) return found;
    if (found.value.status === 'completed' && found.value.artifact !== null) {
      try {
        return parse(JSON.parse(found.value.artifact));
      } catch {
        return err(CreationOutputInvalid());
      }
    }
    return pool(async () => {
      if (signal.aborted) return err(CancelledError());
      const started = await state.patch(projectId, found.value.id, { status: 'running', progress: 0.1 });
      if (!started.ok) return started;
      let result: Result<T>;
      try {
        result = await work(found.value);
      } catch {
        result = err(CreationOutputInvalid(undefined, { detail: 'A production task failed unexpectedly.' }));
      }
      if (signal.aborted) result = err(CancelledError());
      const saved = await state.patch(
        projectId,
        found.value.id,
        result.ok
          ? { status: 'completed', progress: 1, artifact: JSON.stringify(result.value) }
          : { status: signal.aborted ? 'cancelled' : 'failed', message: result.error.code },
      );
      return saved.ok ? result : saved;
    });
  }

  async function charge<T>(
    task: CreationTask,
    estimate: number,
    work: () => AsyncResult<{ value: T; usageMicros: number; tokens: number }>,
  ): AsyncResult<T> {
    const reservation = Math.max(0, Math.ceil(estimate));
    if (!Number.isSafeInteger(reservation)) return err(CreationBudgetExceeded());
    let denied = false;
    const reserved = await state.update(projectId, (project) => {
      const budget = project.budget;
      denied =
        budget.capMicros !== null &&
        budget.spentMicros + budget.reservedMicros + reservation > budget.capMicros;
      return denied
        ? project
        : { ...project, budget: { ...budget, reservedMicros: budget.reservedMicros + reservation } };
    });
    if (!reserved.ok) return reserved;
    if (denied) return err(CreationBudgetExceeded());
    let response: Result<{ value: T; usageMicros: number; tokens: number }>;
    try {
      response = await work();
    } catch {
      response = err(CreationOutputInvalid());
    }
    // A transport failure or cancelled provider can still be billed. Only an explicit retry may release
    // this uncertain reservation; pretending it cost zero would silently spend the same budget twice.
    if (!response.ok)
      return reservation > 0
        ? err(
            CreationInterruptedCharge(undefined, {
              detail: `Provider usage is unknown: ${response.error.code}`,
            }),
          )
        : response;
    const usage = Math.max(0, Math.ceil(response.value.usageMicros));
    const tokens = Math.max(0, Math.ceil(response.value.tokens));
    if (!Number.isSafeInteger(usage) || !Number.isSafeInteger(tokens))
      return err(CreationInterruptedCharge());
    const settled = await state.update(projectId, (project) => ({
      ...project,
      budget: {
        ...project.budget,
        reservedMicros: Math.max(0, project.budget.reservedMicros - reservation),
        spentMicros: project.budget.spentMicros + usage,
      },
      tasks: project.tasks.map((t) =>
        t.id === task.id ? { ...t, costMicros: t.costMicros + usage, tokens: t.tokens + tokens } : t,
      ),
    }));
    if (!settled.ok) return settled;
    return ok(response.value.value);
  }

  async function complete<T>(
    task: CreationTask,
    schema: z.ZodType<T>,
    request: Omit<CreationModelRequest, 'taskId' | 'signal'>,
  ): AsyncResult<T> {
    const response = await charge(task, deps.model.estimate(request), async () => {
      const result = await deps.model.complete({ ...request, taskId: task.id, signal });
      return result.ok
        ? ok({ value: result.value.text, usageMicros: result.value.usageMicros, tokens: result.value.tokens })
        : result;
    });
    if (!response.ok) return response;
    try {
      const parsed = schema.safeParse(parseCreationJson(response.value));
      return parsed.success
        ? ok(parsed.data)
        : err(CreationOutputInvalid(undefined, { detail: parsed.error.message.slice(0, 600) }));
    } catch {
      return err(CreationOutputInvalid(undefined, { detail: 'The model did not return valid JSON.' }));
    }
  }

  function model<T>(
    key: string,
    role: CreationTask['role'],
    revision: number,
    schema: z.ZodType<T>,
    system: string,
    prompt: string,
    imageAssetIds?: CreationModelRequest['imageAssetIds'],
  ) {
    return execute(
      key,
      role,
      revision,
      (value) => {
        const parsed = schema.safeParse(value);
        return parsed.success ? ok(parsed.data) : err(CreationOutputInvalid());
      },
      (task) =>
        complete(task, schema, {
          projectId,
          role,
          system,
          prompt,
          maxTokens: 12_000,
          ...(imageAssetIds?.length ? { imageAssetIds } : {}),
        }),
    );
  }
  return { execute, model, charge };
}
export type CreationTasks = ReturnType<typeof creationTasks>;
export type CreationWorkers = ReturnType<typeof creationWorkerPool>;
