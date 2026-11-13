// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The design eval's workspace (HFW1 dsn): core's WorkspaceStore over a scratch folder, its blobs where the render
 * engine reads them (`<root>/workspaces/<projectId>/blobs/…`, core `workspaceBlobPath`) and its revisions in memory,
 * with `workspace.writeFiles` and `workspace.restore` as commands (the port's contract; the app's store is the
 * library's, with SQLite).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ConflictError,
  defineCommand,
  err,
  NotFoundError,
  ok,
  WORKSPACE_COMMANDS,
  workspaceBlobPath,
  workspaceCommandPayloads,
  type ProjectId,
  type WorkspaceRevision,
  type WorkspaceStore,
} from '@taalcut/core';

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export function diskWorkspace(root: string) {
  const revisions = new Map<string, WorkspaceRevision[]>();
  const heads = new Map<string, number>();
  const blobAt = (projectId: string, sha256: string) => join(root, workspaceBlobPath(projectId, sha256));
  const store: WorkspaceStore = {
    putBlob: async (projectId, data) => {
      const sha256 = sha(data);
      const path = blobAt(projectId, sha256);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
      return ok({ sha256, bytes: data.byteLength });
    },
    readBlob: async (projectId, sha256) => {
      const data = await readFile(blobAt(projectId, sha256)).catch(() => null);
      return data ? ok(new Uint8Array(data)) : err(NotFoundError({ entity: 'workspaceBlob', id: sha256 }));
    },
    head: async (projectId) => {
      const head = heads.get(projectId) ?? 0;
      return ok(head === 0 ? null : (revisions.get(projectId)?.[head - 1] ?? null));
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
        if ('delete' in change) files.delete(change.path);
        else {
          const data = await store.readBlob(payload.projectId as ProjectId, change.sha256);
          if (!data.ok) return data;
          files.set(change.path, { path: change.path, sha256: change.sha256, bytes: data.value.byteLength });
        }
      }
      const list = [...(revisions.get(payload.projectId) ?? [])].slice(0, head);
      const revision = list.length + 1;
      list.push({
        projectId: payload.projectId,
        revision,
        base: head,
        files: [...files.values()],
        createdAt: Date.now(),
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
  return { store, commands: [writeFiles, restore] };
}
