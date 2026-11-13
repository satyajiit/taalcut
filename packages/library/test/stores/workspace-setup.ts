// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A library with a project, a timeline, the workspace store and its commands on a bus, as the agent root wires
 * them (HFW1-WS tests). Files are made-up text; `renameTimeline` is a stand-in timeline edit for the group tests.
 */
import { join } from 'node:path';
import {
  createCommandBus,
  defineCommand,
  idSchema,
  newId,
  ok,
  unwrap,
  WORKSPACE_COMMANDS,
  type CommandGroup,
  type CommandOrigin,
  type GraphicComposition,
  type ProjectId,
  type Timeline,
  type TimelineId,
  type TimelineStore,
  type WorkspaceFile,
} from '@taalcut/core';
import { z } from 'zod';
import {
  createLibraryPorts,
  createTimelineStore,
  createWorkspaceCommands,
  createWorkspaceStore,
  type LibraryDatabase,
} from '../../src/index';
import { openTestDb, tempDir } from '../helpers';
import { seed, T0, timeline as timelineDocument } from './documents';

export const person: CommandOrigin = { source: 'ui', actor: 'user' };
export const agent: CommandOrigin = { source: 'agent', actor: 'agent:run' };
export const mcp: CommandOrigin = { source: 'mcp', actor: 'mcp:client' };
export const W = WORKSPACE_COMMANDS;
export const code = (result: { ok: boolean; error?: { code: string } }) =>
  result.ok ? 'ok' : result.error?.code;
export const bytes = (text: string) => new TextEncoder().encode(text);
export const text = (data: Uint8Array) => new TextDecoder().decode(data);

/** A stand-in timeline edit: renames the timeline, undoable, staged with the command like every timeline write. */
export function renameTimeline(timelines: TimelineStore) {
  const command = defineCommand({
    name: 'test.renameTimeline',
    payload: z.object({
      projectId: idSchema<'Project'>(),
      timelineId: idSchema<'Timeline'>(),
      name: z.string(),
    }),
    sideEffect: 'write',
    handle: async ({ projectId, timelineId, name }, context) => {
      const stored = await timelines.get(timelineId);
      if (!stored.ok) return stored;
      const document = stored.value.json as Timeline;
      const put = await timelines.put({ ...document, name }, stored.value.summary.revision, context);
      if (!put.ok) return put;
      return ok({
        result: null,
        inverse: { name: 'test.renameTimeline', payload: { projectId, timelineId, name: document.name } },
      });
    },
  });
  return command;
}

/** A made-up composition copy over `files` (a test fixture: no design ships from here). */
export function compositionOf(files: readonly WorkspaceFile[]): GraphicComposition {
  return {
    id: newId<'GraphicComposition'>(),
    version: 1,
    hash: 'c'.repeat(64),
    name: 'Test card',
    entry: files[0]!.path,
    files: [...files],
    variables: [{ type: 'text', name: 'words', maxLength: 80, sample: 'Lorem ipsum' }],
    durationSeconds: 2,
    provenance: { model: { id: 'stand-in', onDevice: true }, overlays: [], brief: null, createdAt: T0 },
    gate: {
      version: 'test-gate/1',
      passed: true,
      checkedAt: T0,
      hfLint: { errors: 0, warnings: 0 },
      checks: [{ id: 'hfLint', status: 'pass' }],
      loweredTweens: 1,
    },
  };
}

export interface WorkspaceSetupOptions {
  /** Reopen an existing library (a restart): its folder. */
  readonly dataRoot?: string;
}

export async function setup(options: WorkspaceSetupOptions = {}) {
  const dataRoot = options.dataRoot ?? tempDir();
  const db: LibraryDatabase = openTestDb({ path: join(dataRoot, 'library.db') });
  const ports = createLibraryPorts(db);
  let now = Date.UTC(2026, 10, 2);
  const clock = { now: () => (now += 1) };
  const bus = createCommandBus({ store: ports.auditLog, clock });
  const timelines = createTimelineStore(db, { commands: ports.commands });
  const store = createWorkspaceStore(db, { dataRoot, commands: ports.commands });
  const commands = createWorkspaceCommands({ store, clock });
  const rename = renameTimeline(timelines);
  bus.register(...commands.all, rename);
  return { dataRoot, db, ports, bus, clock, timelines, store, commands, rename };
}

export type WorkspaceSetup = Awaited<ReturnType<typeof setup>>;

/** A project with a timeline in the setup's library. */
export async function withProject(world: WorkspaceSetup) {
  const { project, assets, repos } = seed(world.db);
  const timeline = timelineDocument(project.id, assets);
  unwrap(await world.timelines.create(timeline));
  return { projectId: project.id, timeline, timelineId: timeline.id as TimelineId, assets, repos };
}

/** Puts each file's bytes, then writes them (null deletes) over the head, as `origin`. */
export async function writeFiles(
  world: WorkspaceSetup,
  projectId: ProjectId,
  files: Record<string, string | null>,
  options: { origin?: CommandOrigin; base?: number; group?: CommandGroup } = {},
) {
  const changes = [];
  for (const [path, content] of Object.entries(files)) {
    if (content === null) changes.push({ path, delete: true as const });
    else changes.push({ path, sha256: unwrap(await world.store.putBlob(projectId, bytes(content))).sha256 });
  }
  return world.bus.dispatch(
    W.writeFiles,
    { projectId, baseRevision: options.base ?? world.store.position(projectId).head, files: changes },
    options.origin ?? agent,
    options.group !== undefined ? { group: options.group } : {},
  );
}

/** The head's files, path → text. */
export async function filesAtHead(world: WorkspaceSetup, projectId: ProjectId) {
  const head = unwrap(await world.store.head(projectId));
  const out: Record<string, string> = {};
  for (const file of head?.files ?? [])
    out[file.path] = text(unwrap(await world.store.readBlob(projectId, file.sha256)));
  return out;
}
