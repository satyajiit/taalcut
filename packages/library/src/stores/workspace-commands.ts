// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * WORKSPACE_COMMANDS (HFW1-WS) on core's bus. Both join their project's history, so the agent's turn group takes
 * a design's files back with the timeline edit that placed it. A write names files by path and sha256 only (the
 * bytes went in first, with `putBlob`), so the audit log keeps paths and hashes, never a file's text.
 *
 * - `workspace.writeFiles` makes the next revision over `baseRevision`, which must be the head (else core.conflict,
 *   whose `id` is the head now). Each written blob must be in the store and match its sha256; the new file list
 *   keeps the limits and path rules (workspace-paths.ts). Its inverse restores the base. A redo moves the head back
 *   to the revision the command made the first time, so redone files have the same revision number.
 * - `workspace.restore` moves the head to a revision the workspace had (0: empty): writeFiles' inverse, and the
 *   files viewer's Restore (a person, source 'ui'). Audited and undoable: its inverse moves the head back.
 * - `_taalcut/` is Taalcut's. Only `writeReserved`, which trusted code calls (the Designer's brief), dispatches a
 *   write there; a tool's, a client's or a person's is refused.
 */
import {
  ConflictError,
  defineCommand,
  err,
  NotFoundError,
  ok,
  ValidationError,
  WORKSPACE_COMMANDS,
  workspaceCommandPayloads,
  type AnyCommand,
  type Clock,
  type CommandBus,
  type CommandContext,
  type CommandGroup,
  type CommandOrigin,
  type ProjectId,
  type Result,
  type WorkspaceCommandResult,
  type WorkspaceFile,
  type WorkspaceFileChange,
} from '@taalcut/core';
import {
  applyWorkspaceChanges,
  isReservedWorkspacePath,
  sameWorkspaceFiles,
  type ResolvedChange,
} from './workspace-paths';
import type { LibraryWorkspaceStore } from './workspace-store';

const N = WORKSPACE_COMMANDS;
const P = workspaceCommandPayloads;

/** Who writes `_taalcut/`: Taalcut's own code in the agent process, never a tool's call or a client. */
const RESERVED_WRITER: CommandOrigin = { source: 'agent', actor: 'taalcut:workspace' };
const isReservedWriter = (context: CommandContext) =>
  context.source === RESERVED_WRITER.source && context.actor === RESERVED_WRITER.actor;

/** Tries a reserved write again when another write moved the head between its read and its dispatch. */
const RESERVED_ATTEMPTS = 3;

export interface WorkspaceCommandDeps {
  readonly store: LibraryWorkspaceStore;
  readonly clock: Clock;
}

/** A trusted write's change: the bytes themselves (put first), or the file gone. */
export type ReservedChange =
  { readonly path: string; readonly data: Uint8Array } | { readonly path: string; readonly delete: true };

export function createWorkspaceCommands({ store, clock }: WorkspaceCommandDeps) {
  const outcome = (projectId: ProjectId, revision: number, before: number) => ({
    result: { projectId, revision },
    inverse: { name: N.restore, payload: { projectId, revision: before } },
  });

  async function filesAt(projectId: ProjectId, revision: number): Promise<Result<readonly WorkspaceFile[]>> {
    if (revision === 0) return ok([]);
    const found = await store.revision(projectId, revision);
    return found.ok ? ok(found.value.files) : found;
  }

  /** Each written blob is in the store, and its size is what it holds. */
  async function resolve(
    projectId: ProjectId,
    changes: readonly WorkspaceFileChange[],
  ): Promise<Result<ResolvedChange[]>> {
    const resolved: ResolvedChange[] = [];
    for (const change of changes) {
      if ('delete' in change) {
        resolved.push(change);
        continue;
      }
      const blob = await store.readBlob(projectId, change.sha256);
      if (!blob.ok) return blob;
      resolved.push({ path: change.path, sha256: change.sha256, bytes: blob.value.length });
    }
    return ok(resolved);
  }

  const writeFiles = defineCommand({
    name: N.writeFiles,
    payload: P[N.writeFiles],
    sideEffect: 'write',
    handle: async ({ projectId, baseRevision, files }, context) => {
      if (!store.hasProject(projectId)) return err(NotFoundError({ entity: 'project', id: projectId }));
      const at = store.position(projectId);
      if (context.replay === 'redo') {
        // The revision it made the first time: its files are what the write made, checked then.
        const made = store.madeBy(context.commandId);
        if (!made.ok) return made;
        if (made.value?.projectId === projectId && made.value.base === at.head) {
          const moved = store.moveHead(context, projectId, made.value.revision, at);
          return moved.ok ? ok(outcome(projectId, made.value.revision, at.head)) : moved;
        }
      } else if (baseRevision !== at.head) {
        return err(
          ConflictError(
            { entity: 'workspaceRevision', id: `${at.head}` },
            { detail: `The workspace is at revision ${at.head}, not ${baseRevision}: read it again` },
          ),
        );
      }
      if (!isReservedWriter(context) && files.some((change) => isReservedWorkspacePath(change.path)))
        return err(
          ValidationError(
            { field: 'files' },
            { detail: '_taalcut/ is read-only: Taalcut writes it. Write your files beside it.' },
          ),
        );
      const current = await filesAt(projectId, at.head);
      if (!current.ok) return current;
      const resolved = await resolve(projectId, files);
      if (!resolved.ok) return resolved;
      const next = applyWorkspaceChanges(current.value, resolved.value);
      if (!next.ok) return next;
      // Nothing changes: no revision, and nothing to undo.
      if (sameWorkspaceFiles(current.value, next.value))
        return ok({ result: { projectId, revision: at.head } });
      const revision = at.latest + 1;
      const committed = store.commit(
        context,
        {
          projectId,
          revision,
          base: at.head,
          files: next.value,
          createdAt: clock.now(),
          origin: context.source,
        },
        at,
      );
      return committed.ok ? ok(outcome(projectId, revision, at.head)) : committed;
    },
  });

  const restore = defineCommand({
    name: N.restore,
    payload: P[N.restore],
    sideEffect: 'write',
    handle: async ({ projectId, revision }, context) => {
      if (!store.hasProject(projectId)) return err(NotFoundError({ entity: 'project', id: projectId }));
      const at = store.position(projectId);
      if (revision === at.head) return ok({ result: { projectId, revision } });
      if (revision !== 0) {
        const target = await store.revision(projectId, revision);
        if (!target.ok) return target;
      }
      const moved = store.moveHead(context, projectId, revision, at);
      return moved.ok ? ok(outcome(projectId, revision, at.head)) : moved;
    },
  });

  /**
   * Trusted code's write to `_taalcut/` (the Designer's brief): puts the bytes, then dispatches
   * `workspace.writeFiles` over the head as Taalcut, in `group` when given (the run's turn, so "Undo all" takes
   * the brief back with the rest). Only `_taalcut/` paths.
   */
  async function writeReserved(
    bus: Pick<CommandBus, 'dispatch'>,
    projectId: ProjectId,
    changes: readonly ReservedChange[],
    options: { readonly group?: CommandGroup } = {},
  ): Promise<Result<WorkspaceCommandResult>> {
    if (changes.length === 0 || changes.some((change) => !isReservedWorkspacePath(change.path)))
      return err(ValidationError({ field: 'files' }, { detail: 'Only _taalcut/ paths' }));
    const files: WorkspaceFileChange[] = [];
    for (const change of changes) {
      if ('delete' in change) {
        files.push({ path: change.path, delete: true });
        continue;
      }
      const put = await store.putBlob(projectId, change.data);
      if (!put.ok) return put;
      files.push({ path: change.path, sha256: put.value.sha256 });
    }
    let last: Result<WorkspaceCommandResult> = err(ValidationError({ field: 'files' }));
    for (let attempt = 0; attempt < RESERVED_ATTEMPTS; attempt += 1) {
      const baseRevision = store.position(projectId).head;
      const receipt = await bus.dispatch(
        writeFiles,
        { projectId, baseRevision, files },
        RESERVED_WRITER,
        options.group !== undefined ? { group: options.group } : {},
      );
      if (receipt.ok) return ok(receipt.value.result);
      last = receipt;
      if (!ConflictError.is(receipt.error)) return receipt;
    }
    return last;
  }

  const all: AnyCommand[] = [writeFiles, restore];
  return {
    writeFiles,
    restore,
    /** Both, for `bus.register(...all)`. */
    all,
    writeReserved,
  };
}

export type WorkspaceCommands = ReturnType<typeof createWorkspaceCommands>;
