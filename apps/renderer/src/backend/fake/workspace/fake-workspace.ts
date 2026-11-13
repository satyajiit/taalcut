// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- error details as the real handlers write them: data for logs, not UI */

/**
 * HFW1-UI: a project's workspace in the preview, as the library keeps it: revisions of files named by content and
 * the blobs behind them. It serves appContract.workspace (`list`, `read`) and WORKSPACE_COMMANDS as their handlers
 * answer: `workspace.writeFiles` makes the next revision over the head (core.conflict when its base isn't the
 * head; core.not_found for a blob the store doesn't hold), `workspace.restore` moves the head to a revision it had
 * (core.not_found otherwise), and each one's inverse is a restore of the head before it, so ⌘Z takes it back. The
 * blobs are the design fixtures' made-up files; nothing here draws them.
 */
import {
  appContract,
  ConflictError,
  defineCommand,
  err,
  implementContract,
  NotFoundError,
  ok,
  toRpcError,
  WORKSPACE_COMMANDS,
  WORKSPACE_LIST_MAX,
  workspaceCommandPayloads,
  type AnyCommand,
  type CommandSource,
  type ProjectId,
  type Result,
  type WorkspaceFile,
  type WorkspaceRevision,
} from '@taalcut/core';
import { DESIGN_FILE_TEXT } from '@taalcut/ui';

interface Workspace {
  head: number;
  readonly revisions: WorkspaceRevision[];
}

export interface FakeWorkspaceDeps {
  readonly now: () => number;
}

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw toRpcError(result.error);
  return result.value;
};

const byteLength = (text: string | null) =>
  text === null ? 2048 : new TextEncoder().encode(text).byteLength;

export function createFakeWorkspace(deps: FakeWorkspaceDeps) {
  const workspaces = new Map<ProjectId, Workspace>();
  const blobs = new Map<string, string | null>(Object.entries(DESIGN_FILE_TEXT));
  const of = (projectId: ProjectId): Workspace => {
    let found = workspaces.get(projectId);
    if (!found) {
      found = { head: 0, revisions: [] };
      workspaces.set(projectId, found);
    }
    return found;
  };
  const filesAt = (workspace: Workspace): readonly WorkspaceFile[] =>
    workspace.revisions.find((each) => each.revision === workspace.head)?.files ?? [];
  const restoreTo = (projectId: ProjectId, revision: number) => ({
    name: WORKSPACE_COMMANDS.restore,
    payload: { projectId, revision },
  });

  /** Seeds a project's revisions (the design fixtures'), its head the newest. */
  function seed(projectId: ProjectId, revisions: readonly WorkspaceRevision[]): void {
    const workspace = of(projectId);
    workspace.revisions.splice(0, workspace.revisions.length, ...revisions);
    workspace.head = revisions.reduce((most, each) => Math.max(most, each.revision), 0);
  }

  /** A revision over the head with these files changed, as `source` wrote it. */
  function write(
    projectId: ProjectId,
    baseRevision: number,
    changes: readonly ({ path: string; sha256: string } | { path: string; delete: true })[],
    source: CommandSource,
  ): Result<{ revision: number; before: number }> {
    const workspace = of(projectId);
    if (baseRevision !== workspace.head)
      return err(
        ConflictError(
          { entity: 'workspace', id: projectId },
          { detail: `base ${baseRevision} asked, head is ${workspace.head}` },
        ),
      );
    const files = new Map(filesAt(workspace).map((file) => [file.path, file]));
    for (const change of changes) {
      if ('delete' in change) {
        files.delete(change.path);
        continue;
      }
      if (!blobs.has(change.sha256))
        return err(NotFoundError({ entity: 'workspaceBlob', id: change.sha256 }));
      files.set(change.path, {
        path: change.path,
        sha256: change.sha256,
        bytes: byteLength(blobs.get(change.sha256) ?? null),
      });
    }
    const revision = workspace.revisions.reduce((most, each) => Math.max(most, each.revision), 0) + 1;
    workspace.revisions.push({
      projectId,
      revision,
      base: workspace.head,
      files: [...files.values()],
      createdAt: deps.now(),
      origin: source,
    });
    const before = workspace.head;
    workspace.head = revision;
    return ok({ revision, before });
  }

  const writeFiles = defineCommand({
    name: WORKSPACE_COMMANDS.writeFiles,
    payload: workspaceCommandPayloads[WORKSPACE_COMMANDS.writeFiles],
    sideEffect: 'write',
    handle: (payload, context) => {
      const written = write(payload.projectId, payload.baseRevision, payload.files, context.source);
      if (!written.ok) return written;
      return ok({
        result: { projectId: payload.projectId, revision: written.value.revision },
        inverse: restoreTo(payload.projectId, written.value.before),
      });
    },
  });

  // Not internal: the files viewer's Restore dispatches it from the window, and ⌘Z takes it back.
  const restore = defineCommand({
    name: WORKSPACE_COMMANDS.restore,
    payload: workspaceCommandPayloads[WORKSPACE_COMMANDS.restore],
    sideEffect: 'write',
    handle: (payload) => {
      const workspace = of(payload.projectId);
      if (payload.revision !== 0 && !workspace.revisions.some((each) => each.revision === payload.revision))
        return err(NotFoundError({ entity: 'workspaceRevision', id: String(payload.revision) }));
      const before = workspace.head;
      workspace.head = payload.revision;
      return ok({
        result: { projectId: payload.projectId, revision: payload.revision },
        inverse: restoreTo(payload.projectId, before),
      });
    },
  });

  const os = implementContract(appContract.workspace);
  const router = os.router({
    list: os.list.handler(({ input }) => {
      const workspace = of(input.projectId);
      const limit = input.limit ?? WORKSPACE_LIST_MAX;
      return {
        head: workspace.head,
        revisions: [...workspace.revisions].sort((a, b) => b.revision - a.revision).slice(0, limit),
      };
    }),
    read: os.read.handler(({ input }) => {
      if (!blobs.has(input.sha256))
        return unwrap(err(NotFoundError({ entity: 'workspaceBlob', id: input.sha256 })));
      const text = blobs.get(input.sha256) ?? null;
      return { sha256: input.sha256, bytes: byteLength(text), text };
    }),
  });

  const commands: AnyCommand[] = [writeFiles, restore];
  return {
    router,
    commands,
    seed,
    /** The head revision's files now (the scripted designs write over it). */
    head: (projectId: ProjectId) => ({ revision: of(projectId).head, files: filesAt(of(projectId)) }),
  };
}

export type FakeWorkspace = ReturnType<typeof createFakeWorkspace>;
