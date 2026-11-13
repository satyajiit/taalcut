// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace tools' test world (HFW1 dsn): a workspace store in memory with `workspace.writeFiles` and
 * `workspace.restore` on a real bus (ws's library store is the real one; this is the port's contract, small), the
 * graphics commands over a timeline in memory, an artifact store in memory, and a tool runner that dispatches a
 * tool's declared command with source 'agent'.
 */
import { createHash } from 'node:crypto';
import {
  ConflictError,
  defineCommand,
  err,
  newId,
  NotFoundError,
  ok,
  ValidationError,
  WORKSPACE_COMMANDS,
  workspaceCommandPayloads,
  type AnyTool,
  type ArtifactId,
  type ArtifactStore,
  type CommandToolContext,
  type ProjectId,
  type StoredArtifact,
  type Timeline,
  type WorkspaceFile,
  type WorkspaceRevision,
  type WorkspaceStore,
} from '@taalcut/core';
import { workspaceToolModule } from '../../../src/workspace/tools/module';
import type { WorkspaceToolDeps } from '../../../src/workspace/tools/deps';
import { graphicsBus } from '../../compositions/support';

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** The WorkspaceStore port in memory, and the two commands' handlers over it. */
export function memoryWorkspace(now = () => 1_000) {
  const blobs = new Map<string, Uint8Array>();
  const revisions = new Map<string, WorkspaceRevision[]>();
  const heads = new Map<string, number>();
  const reserved = new Map<string, Map<string, WorkspaceFile>>();
  const store: WorkspaceStore = {
    putBlob: async (_projectId, data) => {
      const sha256 = sha(data);
      blobs.set(sha256, data);
      return ok({ sha256, bytes: data.byteLength });
    },
    readBlob: async (_projectId, sha256) => {
      const data = blobs.get(sha256);
      return data ? ok(data) : err(NotFoundError({ entity: 'workspaceBlob', id: sha256 }));
    },
    head: async (projectId) => {
      const head = heads.get(projectId) ?? 0;
      const baseRev = head === 0 ? null : (revisions.get(projectId)?.[head - 1] ?? null);
      const resMap = reserved.get(projectId);
      if (!baseRev && (!resMap || resMap.size === 0)) return ok(null);
      const merged = new Map((baseRev?.files ?? []).map((file) => [file.path, file]));
      if (resMap) {
        for (const [path, file] of resMap) merged.set(path, file);
      }
      return ok({
        projectId,
        revision: head,
        base: baseRev?.base ?? 0,
        files: [...merged.values()],
        createdAt: baseRev?.createdAt ?? now(),
        origin: baseRev?.origin ?? 'agent',
      } as WorkspaceRevision);
    },
    writeReserved: async (projectId, path, data) => {
      const sha256 = sha(data);
      blobs.set(sha256, data);
      const file: WorkspaceFile = { path, sha256, bytes: data.byteLength };
      const projectReserved = reserved.get(projectId) ?? new Map<string, WorkspaceFile>();
      projectReserved.set(path, file);
      reserved.set(projectId, projectReserved);
      return ok(file);
    },
    readFile: async (projectId, path) => {
      const current = await store.head(projectId);
      if (!current.ok) return current;
      const file = current.value?.files.find((entry) => entry.path === path);
      if (!file) return err(NotFoundError({ entity: 'workspaceFile', id: path }));
      return store.readBlob(projectId, file.sha256);
    },
    revision: async (projectId, revision) => {
      const found = revisions.get(projectId)?.[revision - 1];
      return found ? ok(found) : err(NotFoundError({ entity: 'workspaceRevision', id: String(revision) }));
    },
  };
  const writeFiles = defineCommand({
    name: WORKSPACE_COMMANDS.writeFiles,
    payload: workspaceCommandPayloads[WORKSPACE_COMMANDS.writeFiles],
    sideEffect: 'write',
    handle: async (payload, context) => {
      const head = heads.get(payload.projectId) ?? 0;
      if (payload.baseRevision !== head) return err(ConflictError({ entity: 'workspace', id: payload.projectId }));
      const before = head === 0 ? [] : (revisions.get(payload.projectId)?.[head - 1]?.files ?? []);
      const files = new Map(before.map((file) => [file.path, file]));
      for (const change of payload.files) {
        if ((change.path.split('/')[0] ?? '').toLowerCase() === '_taalcut')
          return err(ValidationError({ field: 'files' }, { detail: '_taalcut/ is reserved' }));
        if ('delete' in change) files.delete(change.path);
        else {
          const data = blobs.get(change.sha256);
          if (!data) return err(NotFoundError({ entity: 'workspaceBlob', id: change.sha256 }));
          files.set(change.path, { path: change.path, sha256: change.sha256, bytes: data.byteLength });
        }
      }
      const list = [...(revisions.get(payload.projectId) ?? [])].slice(0, head);
      const revision = list.length + 1;
      list.push({
        projectId: payload.projectId,
        revision,
        base: head,
        files: [...files.values()],
        createdAt: now(),
        origin: context.source,
      });
      revisions.set(payload.projectId, list);
      heads.set(payload.projectId, revision);
      return ok({
        result: { projectId: payload.projectId, revision },
        inverse: { name: WORKSPACE_COMMANDS.restore, payload: { projectId: payload.projectId, revision: head } },
      });
    },
  });
  const restore = defineCommand({
    name: WORKSPACE_COMMANDS.restore,
    payload: workspaceCommandPayloads[WORKSPACE_COMMANDS.restore],
    sideEffect: 'write',
    internal: true,
    handle: async (payload) => {
      const head = heads.get(payload.projectId) ?? 0;
      heads.set(payload.projectId, payload.revision);
      return ok({
        result: { projectId: payload.projectId, revision: payload.revision },
        inverse: { name: WORKSPACE_COMMANDS.restore, payload: { projectId: payload.projectId, revision: head } },
      });
    },
  });
  return { store, commands: [writeFiles, restore], heads };
}

/** Artifacts in memory. */
export function memoryArtifacts(): ArtifactStore & { readonly all: Map<string, StoredArtifact> } {
  const all = new Map<string, StoredArtifact>();
  return {
    all,
    put: async (input) => {
      const data = typeof input.data === 'string' ? new TextEncoder().encode(input.data) : input.data;
      const ref = { id: newId<'Artifact'>(), mediaType: input.mediaType, bytes: data.byteLength, summary: input.summary };
      all.set(ref.id, { ref, data });
      return ok(ref);
    },
    get: async (id: ArtifactId) => {
      const found = all.get(id);
      return found ? ok(found) : err(NotFoundError({ entity: 'artifact', id }));
    },
  };
}

/** The tools over a timeline in memory, with a runner that dispatches each tool's command on the bus. */
export function workspaceWorld(timeline: Timeline, extra: Partial<WorkspaceToolDeps> = {}) {
  const graphics = graphicsBus(timeline);
  const workspace = memoryWorkspace();
  graphics.bus.register(...workspace.commands);
  const artifacts = memoryArtifacts();
  const deps: WorkspaceToolDeps = { store: workspace.store, timelines: graphics.store, now: () => 2_000, ...extra };
  const module = workspaceToolModule(deps);
  const runId = newId<'AgentRun'>();
  const tool = (name: string): AnyTool => {
    const found = module.tools.find((entry) => entry.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
  async function call(name: string, input: unknown) {
    const spec = tool(name);
    const parsed = spec.input.safeParse(input);
    if (!parsed.success) throw new Error(`${name}: ${parsed.error.message}`);
    const ctx: CommandToolContext = {
      signal: new AbortController().signal,
      callId: newId<'ToolRun'>(),
      runId,
      attempt: 1,
      artifacts,
      reportUsage: () => undefined,
      reportProgress: () => undefined,
      dispatch: async (payload) => {
        if (!spec.command) throw new Error(`${name} declares no command`);
        const done = await graphics.bus.dispatch(spec.command, payload, { source: 'agent', actor: 'agent:run' });
        return done.ok ? ok(done.value.result) : done;
      },
    };
    const done = await spec.run(parsed.data, ctx as never);
    if (!done.ok) return done;
    return ok(spec.output.parse(done.value) as Record<string, unknown>);
  }
  const projectId = timeline.projectId as ProjectId;
  return { ...graphics, workspace, artifacts, module, tool, call, projectId, runId };
}
