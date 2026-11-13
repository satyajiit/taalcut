// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { defineError } from '../basics/errors';
import { idSchema, type ProjectId, type RunId } from '../basics/ids';
import { err, ok, type AsyncResult, type Result } from '../basics/result';
import { createToken } from '../di/token';
import type { CommandOrigin } from './definition';
import { editorContextSchema, type EditorContext } from '../timeline/edit-target';

export const ProjectEditing = defineError<{ projectId: string }>('core.project_editing', { retryable: true });
export const EditingStopped = defineError('core.editing_stopped');

const changeSchema = z.object({
  timelineId: idSchema<'Timeline'>(),
  revision: z.number(),
  affectedItemIds: z.array(z.string()),
});
export const editorActivitySchema = z.object({
  projectId: idSchema<'Project'>(),
  runId: idSchema<'AgentRun'>().nullable(),
  phase: z.enum(['idle', 'editing', 'stopping', 'interrupted']),
  generation: z.int().nonnegative(),
  context: editorContextSchema.optional(),
  targetItemIds: z.array(z.string()).optional(),
  changedItemIds: z.array(z.string()).optional(),
  changes: z.array(changeSchema).optional(),
});
export type EditorActivity = z.output<typeof editorActivitySchema>;

export interface EditingOwnership {
  snapshot(projectId: ProjectId): EditorActivity;
  subscribe(changed: (activity: EditorActivity) => void): () => void;
  acquire(
    projectId: ProjectId,
    runId: RunId,
    context?: EditorContext,
    targetItemIds?: string[],
  ): AsyncResult<void>;
  /** Reject queued and future writes immediately; release waits for executing commands to settle. */
  stop(runId: RunId): void;
  drain(): Promise<void>;
  committed(origin: CommandOrigin, result: unknown): void;
  release(runId: RunId): Promise<void>;
  restore(
    projectId: ProjectId,
    runId: RunId,
    context?: EditorContext,
    targetItemIds?: string[],
  ): Result<void>;
  check(projectIds: readonly ProjectId[], origin: CommandOrigin): Result<void>;
}

export const EditingOwnershipToken = createToken<EditingOwnership>('core.editingOwnership');

/** Agent-process ownership. Renderers can observe it but cannot acquire, release or impersonate a run. */
export function createEditingOwnership(settled: () => Promise<void>): EditingOwnership {
  const owners = new Map<ProjectId, EditorActivity>();
  const completed = new Map<ProjectId, EditorActivity>();
  const revoked = new Set<string>();
  const listeners = new Set<(activity: EditorActivity) => void>();
  let generation = 0;
  const snapshot = (projectId: ProjectId): EditorActivity =>
    owners.get(projectId) ??
    completed.get(projectId) ?? {
      projectId,
      runId: null,
      phase: 'idle',
      generation,
    };
  function publish(
    projectId: ProjectId,
    runId: RunId | null,
    phase: EditorActivity['phase'],
    context?: EditorContext,
    targetItemIds?: string[],
  ) {
    const kept = context ?? owners.get(projectId)?.context;
    const activity = {
      projectId,
      runId,
      phase,
      generation: ++generation,
      changedItemIds: owners.get(projectId)?.changedItemIds ?? [],
      changes: owners.get(projectId)?.changes ?? [],
      ...(phase !== 'idle' && kept ? { context: kept } : {}),
      ...(phase !== 'idle'
        ? { targetItemIds: targetItemIds ?? owners.get(projectId)?.targetItemIds ?? [] }
        : {}),
    };
    if (phase === 'idle') {
      owners.delete(projectId);
      completed.set(projectId, activity);
    } else owners.set(projectId, activity);
    for (const listener of listeners) listener(activity);
  }
  function reserve(
    projectId: ProjectId,
    runId: RunId,
    phase: 'editing' | 'interrupted',
    context?: EditorContext,
    targetItemIds?: string[],
  ): Result<void> {
    const owner = owners.get(projectId);
    if (revoked.has(`agent:${runId}`)) return err(EditingStopped());
    if (owner && owner.runId !== runId) return err(ProjectEditing({ projectId }));
    publish(projectId, runId, phase, context, targetItemIds);
    return ok(undefined);
  }
  return {
    snapshot,
    drain: settled,
    committed(origin, result) {
      if (origin.source !== 'agent') return;
      const receipt = z
        .object({
          affectedItemIds: z.array(z.string()).optional(),
          receipts: z.array(z.object({ affectedItemIds: z.array(z.string()) })).optional(),
        })
        .safeParse(result);
      if (!receipt.success) return;
      const ids = [
        ...(receipt.data.affectedItemIds ?? []),
        ...(receipt.data.receipts ?? []).flatMap((value) => value.affectedItemIds),
      ];
      const direct = changeSchema.safeParse(result);
      const batch = z.object({ receipts: z.array(changeSchema) }).safeParse(result);
      const changes = direct.success ? [direct.data] : batch.success ? batch.data.receipts : [];
      for (const owner of owners.values()) {
        if (`agent:${owner.runId}` !== origin.actor) continue;
        const byTimeline = new Map((owner.changes ?? []).map((change) => [change.timelineId, change]));
        for (const change of changes) {
          const old = byTimeline.get(change.timelineId);
          byTimeline.set(change.timelineId, {
            ...change,
            affectedItemIds: [...new Set([...(old?.affectedItemIds ?? []), ...change.affectedItemIds])],
          });
        }
        const activity = {
          ...owner,
          changes: [...byTimeline.values()],
          generation: ++generation,
          changedItemIds: [...new Set([...(owner.changedItemIds ?? []), ...ids])],
        };
        owners.set(owner.projectId, activity);
        for (const listener of listeners) listener(activity);
      }
    },
    subscribe(changed) {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
    async acquire(projectId, runId, context, targetItemIds) {
      const reserved = reserve(projectId, runId, 'editing', context, targetItemIds);
      if (!reserved.ok) return reserved;
      // Includes app-wide batches already executing when ownership was requested.
      await settled();
      return revoked.has(`agent:${runId}`) ? err(EditingStopped()) : ok(undefined);
    },
    restore: (projectId, runId, context, targetItemIds) =>
      reserve(projectId, runId, 'interrupted', context, targetItemIds),
    stop(runId) {
      revoked.add(`agent:${runId}`);
      for (const owner of [...owners.values()]) {
        if (owner.runId === runId) publish(owner.projectId, runId, 'stopping');
      }
    },
    async release(runId) {
      await settled();
      for (const owner of [...owners.values()]) {
        if (owner.runId === runId) publish(owner.projectId, null, 'idle');
      }
    },
    check(projectIds, origin) {
      if (origin.source === 'agent' && revoked.has(origin.actor)) return err(EditingStopped());
      for (const projectId of projectIds) {
        const owner = owners.get(projectId);
        if (
          owner &&
          (owner.phase !== 'editing' || origin.source !== 'agent' || origin.actor !== `agent:${owner.runId}`)
        )
          return err(ProjectEditing({ projectId }));
      }
      return ok(undefined);
    },
  };
}
