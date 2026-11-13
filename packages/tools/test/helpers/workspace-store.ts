// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An in-memory HFW1 workspace store and its `workspace.writeFiles`, as the library keeps them: blobs by sha256,
 * revisions over a base (core.conflict when the base isn't the head), the limits refused. For the shell's tools.
 */
import { createHash } from 'node:crypto';
import {
  ConflictError,
  err,
  newId,
  NotFoundError,
  ok,
  ValidationError,
  WORKSPACE_LIMITS,
  type AsyncResult,
  type ProjectId,
  type WorkspaceFile,
  type WorkspaceRevision,
  type WorkspaceStore,
} from '@taalcut/core';
import { createMemoryArtifactStore } from '../../src/stores';

export interface MemoryWorkspace {
  readonly store: WorkspaceStore;
  /** workspace.writeFiles' handler: what a tool's ctx.dispatch reaches. */
  readonly dispatch: (payload: unknown) => AsyncResult<unknown>;
  readonly dispatched: unknown[];
  /** Writes text files as one revision (a test's own writeFiles). */
  write(projectId: ProjectId, files: Record<string, string>): Promise<number>;
  text(projectId: ProjectId, path: string): Promise<string | undefined>;
}

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export function memoryWorkspace(): MemoryWorkspace {
  const blobs = new Map<string, Uint8Array>();
  const revisions = new Map<string, WorkspaceRevision[]>();
  const dispatched: unknown[] = [];
  const headOf = (projectId: string) => revisions.get(projectId)?.at(-1) ?? null;

  const store: WorkspaceStore = {
    async putBlob(_projectId, data) {
      if (data.byteLength > WORKSPACE_LIMITS.fileBytes) return err(ValidationError({ field: 'data' }));
      const hash = sha(data);
      blobs.set(hash, data);
      return ok({ sha256: hash, bytes: data.byteLength });
    },
    async readBlob(_projectId, hash) {
      const data = blobs.get(hash);
      return data ? ok(data) : err(NotFoundError({ entity: 'workspaceBlob', id: hash }));
    },
    async head(projectId) {
      return ok(headOf(projectId));
    },
    async revision(projectId, n) {
      const found = revisions.get(projectId)?.find((r) => r.revision === n);
      return found ? ok(found) : err(NotFoundError({ entity: 'workspaceRevision' }));
    },
  };

  const dispatch = async (payload: unknown): AsyncResult<unknown> => {
    dispatched.push(payload);
    const { projectId, baseRevision, files } = payload as {
      projectId: ProjectId;
      baseRevision: number;
      files: ({ path: string; sha256: string } | { path: string; delete: true })[];
    };
    if (files.length > WORKSPACE_LIMITS.files) return err(ValidationError({ field: 'files' }));
    const head = headOf(projectId);
    if ((head?.revision ?? 0) !== baseRevision) return err(ConflictError({ entity: 'workspace' }));
    const next = new Map((head?.files ?? []).map((file) => [file.path, file]));
    for (const change of files) {
      if ('delete' in change) next.delete(change.path);
      else {
        const data = blobs.get(change.sha256);
        if (!data) return err(NotFoundError({ entity: 'workspaceBlob' }));
        next.set(change.path, { path: change.path, sha256: change.sha256, bytes: data.byteLength });
      }
    }
    const revision = (head?.revision ?? 0) + 1;
    const list = revisions.get(projectId) ?? [];
    list.push({
      projectId,
      revision,
      base: baseRevision,
      files: [...next.values()] as WorkspaceFile[],
      createdAt: Date.now(),
      origin: 'agent',
    });
    revisions.set(projectId, list);
    return ok({ projectId, revision });
  };

  return {
    store,
    dispatch,
    dispatched,
    async write(projectId, texts) {
      const head = headOf(projectId);
      const files = [];
      for (const [path, text] of Object.entries(texts)) {
        const put = await store.putBlob(projectId, new TextEncoder().encode(text));
        if (!put.ok) throw new Error(put.error.code);
        files.push({ path, sha256: put.value.sha256 });
      }
      const done = await dispatch({ projectId, baseRevision: head?.revision ?? 0, files });
      dispatched.pop();
      if (!done.ok) throw new Error(done.error.code);
      return (done.value as { revision: number }).revision;
    },
    async text(projectId, path) {
      const file = headOf(projectId)?.files.find((entry) => entry.path === path);
      const data = file ? blobs.get(file.sha256) : undefined;
      return data ? new TextDecoder().decode(data) : undefined;
    },
  };
}

/** A tool's context: an abort signal, a run, the dispatch of its command and an artifact store. */
export function toolContext(dispatch: (payload: unknown) => AsyncResult<unknown>) {
  return {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: createMemoryArtifactStore(),
    reportUsage: () => undefined,
    reportProgress: () => undefined,
    dispatch,
  } as never;
}
