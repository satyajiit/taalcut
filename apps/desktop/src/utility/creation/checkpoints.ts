// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { isDeepStrictEqual } from 'node:util';
import {
  CommandBusToken,
  ConflictError,
  creationProjectSchema,
  creationSourceSchema,
  creationTaskSchema,
  defineCommand,
  err,
  idSchema,
  ok,
  ValidationError,
  type Container,
  type CreationProject,
  type CreationStore,
  type Result,
} from '@taalcut/core';
import { z } from 'zod';
import { creationCommandKit } from './command-kit';

export const CREATION_CHECKPOINT = 'creation.checkpoint';
const definedFields = (value: object) => Object.values(value).every((field) => field !== undefined);
const metadataSchema = creationProjectSchema
  .omit({ projectId: true, revision: true, createdAt: true, tasks: true, sources: true })
  .partial()
  .strict()
  .refine(definedFields, 'Use an explicit unset for optional fields.');
const taskPatchSchema = creationTaskSchema.omit({ id: true }).partial().strict().refine(definedFields);
// Defaults belong to full records. A partial patch must not erase previously captured asset ids.
const sourcePatchSchema = z
  .object({
    ...creationSourceSchema.shape,
    assetIds: creationSourceSchema.shape.assetIds.removeDefault(),
  })
  .omit({ id: true })
  .partial()
  .strict()
  .refine(definedFields);

export const creationCheckpointSchema = z
  .object({
    projectId: idSchema<'Project'>(),
    expectedRevision: z.int().positive(),
    metadata: metadataSchema.optional(),
    unsetMetadata: z.array(z.literal('publicationBase')).max(1).optional(),
    tasks: z
      .object({
        changes: z
          .array(z.object({ id: idSchema<'CreationTask'>(), patch: taskPatchSchema }).strict())
          .max(200),
        order: z.array(idSchema<'CreationTask'>()).max(200).optional(),
      })
      .strict()
      .optional(),
    sources: z
      .object({
        changes: z
          .array(
            z
              .object({
                id: idSchema<'CreationSource'>(),
                patch: sourcePatchSchema,
                unset: z
                  .array(z.enum(['url', 'accessId', 'assetId', 'content']))
                  .max(4)
                  .optional(),
              })
              .strict(),
          )
          .max(50),
        order: z.array(idSchema<'CreationSource'>()).max(50).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CreationCheckpoint = z.output<typeof creationCheckpointSchema>;

const invalid = (detail: string) => err(ValidationError({ field: 'creationCheckpoint' }, { detail }));
const conflict = (projectId: CreationProject['projectId']) =>
  err(ConflictError({ entity: 'creationProject', id: projectId }));
const metadataExcluded = new Set(['projectId', 'revision', 'createdAt', 'tasks', 'sources']);

function fieldsChanged(before: object, after: object, excluded: ReadonlySet<string>) {
  const previous = Object.fromEntries(Object.entries(before));
  const next = Object.fromEntries(Object.entries(after));
  const patch: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (excluded.has(key) || isDeepStrictEqual(previous[key], next[key])) continue;
    if (next[key] === undefined) unset.push(key);
    else patch[key] = next[key];
  }
  return { patch, ...(unset.length ? { unset } : {}) };
}

function rowsChanged<T extends { id: string }>(before: readonly T[], after: readonly T[]) {
  const previous = new Map(before.map((row) => [row.id, row]));
  const changes = after.flatMap((row) => {
    const change = fieldsChanged(previous.get(row.id) ?? {}, row, new Set(['id']));
    return Object.keys(change.patch).length || change.unset?.length ? [{ id: row.id, ...change }] : [];
  });
  const ids = after.map((row) => row.id);
  const order = isDeepStrictEqual(
    before.map((row) => row.id),
    ids,
  )
    ? undefined
    : ids;
  return changes.length || order ? { changes, ...(order ? { order } : {}) } : undefined;
}

interface RowChanges {
  readonly changes: readonly {
    readonly id: string;
    readonly patch: Readonly<Record<string, unknown>>;
    readonly unset?: readonly string[];
  }[];
  readonly order?: readonly string[];
}

function mergeFields(
  before: object,
  patch: Readonly<Record<string, unknown>>,
  unset: readonly string[] = [],
) {
  const next = { ...before, ...patch } as Record<string, unknown>;
  for (const key of unset) {
    if (Object.hasOwn(patch, key)) return invalid('A checkpoint cannot set and remove the same field.');
    delete next[key];
  }
  return ok(next);
}

function mergeRows<T extends { id: string }>(
  before: readonly T[],
  delta: RowChanges | undefined,
  schema: z.ZodType<T>,
): Result<T[]> {
  const rows = new Map(before.map((row) => [row.id, row]));
  if (rows.size !== before.length) return invalid('Repeated stored checkpoint row id.');
  if (!delta) return ok([...before]);
  const order = delta.order ?? before.map((row) => row.id);
  if (new Set(order).size !== order.length) return invalid('Repeated checkpoint order id.');
  const changed = new Set<string>();
  for (const change of delta.changes) {
    if (changed.has(change.id) || !order.includes(change.id))
      return invalid('A changed row must appear exactly once in the checkpoint order.');
    changed.add(change.id);
    const merged = mergeFields(rows.get(change.id) ?? { id: change.id }, change.patch, change.unset);
    if (!merged.ok) return merged;
    const parsed = schema.safeParse(merged.value);
    if (!parsed.success || parsed.data.id !== change.id) return invalid('Invalid checkpoint row.');
    rows.set(change.id, parsed.data);
  }
  if (order.some((id) => !rows.has(id))) return invalid('Checkpoint order names an unknown row.');
  return ok(order.map((id) => rows.get(id)!));
}

/** Checkpoints are not undo steps; their staged state and small audit record commit together. */
export function creationCheckpointCommand(container: Container) {
  const kit = creationCommandKit(container);
  return defineCommand({
    name: CREATION_CHECKPOINT,
    payload: creationCheckpointSchema,
    internal: true,
    sideEffect: 'write',
    handle: kit.handle(async (input, context) => {
      const found = await kit.store.get(input.projectId);
      if (!found.ok) return found;
      const before = found.value;
      if (before.revision !== input.expectedRevision) return conflict(input.projectId);
      const tasks = mergeRows(before.tasks, input.tasks, creationTaskSchema);
      if (!tasks.ok) return tasks;
      const sources = mergeRows(before.sources, input.sources, creationSourceSchema);
      if (!sources.ok) return sources;
      const metadata = mergeFields(before, input.metadata ?? {}, input.unsetMetadata);
      if (!metadata.ok) return metadata;
      const parsed = creationProjectSchema.safeParse({
        ...metadata.value,
        tasks: tasks.value,
        sources: sources.value,
        revision: before.revision + 1,
      });
      if (!parsed.success) return invalid('The checkpoint does not form a valid creation project.');
      const saved = await kit.store.save(parsed.data, input.expectedRevision, context);
      if (!saved.ok) return saved;
      kit.note(context, 'project', input.projectId);
      return ok({ result: undefined });
    }),
  });
}

/** Diff against the durable revision, then let the command recheck CAS inside its atomic audit transaction. */
export function creationCheckpointStore(container: Container, store: CreationStore): CreationStore {
  return {
    get: (projectId) => store.get(projectId),
    list: () => store.list(),
    async save(project, expectedRevision) {
      const found = await store.get(project.projectId);
      if (!found.ok) return found;
      if (found.value.revision !== expectedRevision) return conflict(project.projectId);
      const parsed = creationProjectSchema.safeParse(project);
      if (
        !parsed.success ||
        project.revision !== expectedRevision + 1 ||
        project.createdAt !== found.value.createdAt
      )
        return invalid('A checkpoint must advance one revision and preserve its creation identity.');
      const next = parsed.data;
      const before = found.value;
      if (
        new Set(next.tasks.map((task) => task.id)).size !== next.tasks.length ||
        new Set(next.sources.map((source) => source.id)).size !== next.sources.length
      )
        return invalid('Repeated checkpoint row id.');
      const metadata = fieldsChanged(before, next, metadataExcluded);
      const tasks = rowsChanged(before.tasks, next.tasks);
      const sources = rowsChanged(before.sources, next.sources);
      const payload = creationCheckpointSchema.safeParse({
        projectId: next.projectId,
        expectedRevision,
        ...(Object.keys(metadata.patch).length ? { metadata: metadata.patch } : {}),
        ...(metadata.unset ? { unsetMetadata: metadata.unset } : {}),
        ...(tasks ? { tasks } : {}),
        ...(sources ? { sources } : {}),
      });
      if (!payload.success) return invalid('Invalid checkpoint delta.');
      const saved = await container
        .resolve(CommandBusToken)
        .dispatch(CREATION_CHECKPOINT, payload.data, {
          source: 'agent',
          actor: `creation:${project.projectId}`,
        });
      return saved.ok ? ok(undefined) : saved;
    },
  };
}
