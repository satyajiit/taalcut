// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.addSource` and its inverse `library.removeSource` on core's
 * command bus (PRD V2), so the "Add folder" button, the ⌘K palette and the
 * agent's tool make the same change with the same audit entry and undo step.
 *
 * A source's id is the id of the command that added it, so redo (which runs
 * the original command again under its original id) re-adds the same source.
 * Handlers check now and stage their write on the command unit of work, so
 * the Source row, its first full scan (a jobs row) and the audit entry commit
 * in one transaction (P1-D5, P2-L2): a crash can't leave a source that is
 * never scanned. Removing a source keeps its assets, detached and hidden, so
 * undo's rescan re-attaches them with their analysis. Without a unit of work
 * (tests over core's in-memory audit log) the write runs at once.
 */
import { basename, sep } from 'node:path';
import {
  defineCommand,
  err,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  newId,
  ok,
  type CommandContext,
  type CommitAnnouncer,
  type JobId,
  type SourceId,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { Conflict } from '../errors';
import type { CommandUnitOfWork, StagedWrite } from '../ports/unit-of-work';
import { inTransaction } from '../repositories/shared';
import type { Source, SourceRepository } from '../repositories/sources';
import { enqueueScan } from './enqueue';
import { FolderNotAllowed, folderParams, TooManySources } from './errors';
import { resolveFolder, type FolderPolicy } from './folders';
import type { VolumeProbe } from './volumes';

export const ADD_SOURCE = LIBRARY_COMMANDS.addSource;
export const REMOVE_SOURCE = LIBRARY_COMMANDS.removeSource;

/** A library holds at most this many watched folders. */
export const MAX_SOURCES = 100;

/** What the commands and tools return about a source. */
export interface SourceInfo {
  readonly id: SourceId;
  readonly name: string;
  /** The folder's real path (symlinks resolved). */
  readonly path: string;
  readonly kind: Source['kind'];
  readonly status: Source['status'];
}

export function sourceInfo(source: Source): SourceInfo {
  return {
    id: source.id as SourceId,
    name: source.displayName,
    path: source.rootPath,
    kind: source.kind,
    status: source.status,
  };
}

export interface SourceCommandDeps {
  readonly sources: Pick<SourceRepository, 'add' | 'get' | 'list' | 'remove'>;
  readonly folders: FolderPolicy;
  /** createLibraryPorts(db).commands: writes commit with the audit entry. */
  readonly commands?: Pick<CommandUnitOfWork, 'stage'>;
  /** With it, adding a source also stages its first full scan (`library.scanSource`). */
  readonly db?: LibraryDatabase;
  /** Records the folder's Volume UUID and name (ADR 0001: a source is root path plus volume). */
  readonly volumes?: VolumeProbe;
  /** The managed originals root (new imports): a watched folder may neither hold it nor sit inside it. */
  readonly originalsRoot?: () => Promise<string | undefined>;
  /** Announces `library.changed` after the staged write commits. */
  readonly announcer?: Pick<CommitAnnouncer, 'note'>;
}

/** Core's payloads (`watch` defaults to true). Kept under the Phase 1 names for existing imports. */
export const addSourcePayload = libraryCommandPayloads[LIBRARY_COMMANDS.addSource];
export const removeSourcePayload = libraryCommandPayloads[LIBRARY_COMMANDS.removeSource];

const inside = (path: string, root: string) =>
  path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

export function createSourceCommands(deps: SourceCommandDeps) {
  /** Stages the write with the audit change, or runs it now when there is no unit of work. */
  const write = (context: CommandContext, change: StagedWrite) => {
    if (!deps.commands) return deps.db ? inTransaction(deps.db, 'source', change) : change();
    return deps.commands.stage(context, change);
  };

  const addSource = defineCommand({
    name: ADD_SOURCE,
    payload: addSourcePayload,
    sideEffect: 'write',
    handle: async (payload, context) => {
      const folder = await resolveFolder(payload.path, deps.folders);
      if (!folder.ok) return folder;
      const rootPath = folder.value;
      const watched = deps.sources.list({ kinds: ['watched_folder'] });
      const taken = watched.find((s) => s.rootPath === rootPath);
      if (taken)
        return err(
          Conflict(
            { entity: 'source', name: taken.displayName },
            { detail: `already in the library as ${taken.id}` },
          ),
        );
      if (watched.length >= MAX_SOURCES) return err(TooManySources({ limit: MAX_SOURCES }));
      const originals = await deps.originalsRoot?.();
      if (originals && (inside(rootPath, originals) || inside(originals, rootPath))) {
        // Managed copies would be indexed twice: once imported, once watched.
        return err(
          FolderNotAllowed(folderParams(rootPath), { detail: 'Holds or is inside the originals folder.' }),
        );
      }
      const id = payload.sourceId ?? (context.commandId as string as SourceId);
      const name = (payload.name ?? basename(rootPath)).trim();
      const volume = await deps.volumes?.identify(rootPath);
      const scanJobId = deps.db ? newId<'Job'>() : undefined;
      const added = write(context, () => {
        const source = deps.sources.add({
          id,
          kind: 'watched_folder',
          displayName: name,
          rootPath,
          watch: payload.watch,
          volumeUuid: volume?.uuid ?? null,
          volumeName: volume?.name ?? null,
        });
        if (!source.ok || !deps.db || !scanJobId) return source;
        return enqueueScan(deps.db, { sourceId: id, mode: 'full' }, { id: scanJobId });
      });
      if (!added.ok) return added;
      deps.announcer?.note(context, { projectId: null, entity: 'source', change: 'created', ids: [id] });
      const result: SourceInfo & { scan?: { jobId: JobId } } = {
        id,
        name,
        path: rootPath,
        kind: 'watched_folder',
        status: 'online',
        ...(scanJobId ? { scan: { jobId: scanJobId } } : {}),
      };
      return ok({ result, inverse: { name: REMOVE_SOURCE, payload: { sourceId: id } } });
    },
  });

  const removeSource = defineCommand({
    name: REMOVE_SOURCE,
    payload: removeSourcePayload,
    // The folder and its files stay where they are; only the library forgets them (undoable).
    sideEffect: 'write',
    handle: (payload, context) => {
      const source = deps.sources.get(payload.sourceId);
      // Already gone: nothing to do and nothing to undo. This is also the bus's rollback of an add
      // whose staged write never committed.
      if (!source.ok) return ok({ result: { removed: payload.sourceId } });
      const removed = write(context, () => deps.sources.remove(payload.sourceId));
      if (!removed.ok) return removed;
      deps.announcer?.note(context, {
        projectId: null,
        entity: 'source',
        change: 'deleted',
        ids: [payload.sourceId],
      });
      const { rootPath: path, displayName: name, watch } = source.value;
      return ok({
        result: { removed: payload.sourceId },
        inverse: { name: ADD_SOURCE, payload: { path, name, sourceId: payload.sourceId, watch } },
      });
    },
  });

  return { addSource, removeSource };
}
