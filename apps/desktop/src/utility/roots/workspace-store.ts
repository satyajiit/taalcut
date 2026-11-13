// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-WS: a project's HyperFrames workspace in the utility processes. The library's store is core's
 * WorkspaceStoreToken wherever the process has the library: the agent's workspace tools put, read and write
 * through it, and the render process reads a composition's blobs to draw it. The agent's bus gets
 * WORKSPACE_COMMANDS (the turn's group takes the files back with the timeline), trusted code gets the `_taalcut/`
 * writer, and the agent prunes once launch has settled. Blobs live in `<userData>/workspaces/<projectId>/blobs/`,
 * which main's app://preview serves read-only (main/render/preview-roots.ts).
 */
import {
  ClockToken,
  CommandBusToken,
  createToken,
  WorkspaceStoreToken,
  type AnyCommand,
  type CommandGroup,
  type Container,
  type ProjectId,
} from '@taalcut/core';
import {
  createWorkspaceCommands,
  createWorkspaceStore,
  type LibraryWorkspaceStore,
  type ReservedChange,
  type WorkspaceCommands,
} from '@taalcut/library';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { LibraryDatabaseToken, LibraryPortsToken } from '../../shared/tokens';

/** The library's store itself (WorkspaceStoreToken's), for the commands and the prune. */
const LibraryWorkspaceStoreToken = createToken<LibraryWorkspaceStore>('desktop.libraryWorkspaceStore');
const WorkspaceCommandsToken = createToken<WorkspaceCommands>('desktop.workspaceCommands');

/** The first prune waits for launch to settle; it is never urgent. */
export const FIRST_WORKSPACE_PRUNE_MS = 90_000;

/** The store, where this process has the library (lazy: nothing opens until something resolves it). */
export function registerWorkspaceStore(container: Container, config: Pick<UtilityConfig, 'userData'>): void {
  if (container.has(WorkspaceStoreToken) || !container.has(LibraryDatabaseToken)) return;
  container
    .factory(
      LibraryWorkspaceStoreToken,
      ({ db, ports }) => createWorkspaceStore(db, { dataRoot: config.userData, commands: ports.commands }),
      { deps: { db: LibraryDatabaseToken, ports: LibraryPortsToken } },
    )
    .factory(WorkspaceStoreToken, ({ store }) => store, { deps: { store: LibraryWorkspaceStoreToken } })
    .factory(WorkspaceCommandsToken, ({ store, clock }) => createWorkspaceCommands({ store, clock }), {
      deps: { store: LibraryWorkspaceStoreToken, clock: ClockToken },
    });
}

/** WORKSPACE_COMMANDS, for the agent process's bus. */
export function workspaceCommands(container: Container): AnyCommand[] {
  return container.has(WorkspaceCommandsToken) ? container.resolve(WorkspaceCommandsToken).all : [];
}

/** Writes `_taalcut/` (the Designer's brief) as Taalcut, on the agent's bus, in the run's turn when given. */
export type WorkspaceReservedWriter = (
  projectId: ProjectId,
  changes: readonly ReservedChange[],
  options?: { readonly group?: CommandGroup },
) => ReturnType<WorkspaceCommands['writeReserved']>;

/** The `_taalcut/` writer, for the Designer's wiring (trusted code only: never hand it to a tool's input). */
export function workspaceReservedWriter(container: Container): WorkspaceReservedWriter | undefined {
  if (!container.has(WorkspaceCommandsToken) || !container.has(CommandBusToken)) return undefined;
  return (projectId, changes, options) =>
    container
      .resolve(WorkspaceCommandsToken)
      .writeReserved(container.resolve(CommandBusToken), projectId, changes, options);
}

/** Prunes the workspace folders once, after launch: blobs nothing names, folders of projects that are gone. */
export function pruneWorkspacesLater(
  container: Container,
  log: (message: string) => void = (message) => console.warn(`[workspace] ${message}`),
  delayMs = FIRST_WORKSPACE_PRUNE_MS,
): void {
  if (!container.has(LibraryWorkspaceStoreToken)) return;
  const prune = async () => {
    try {
      const pruned = await container.resolve(LibraryWorkspaceStoreToken).prune();
      if (!pruned.ok) log(`prune failed: ${pruned.error.code}`);
    } catch (cause) {
      log(`prune threw: ${String(cause)}`);
    }
  };
  setTimeout(() => void prune(), delayMs).unref?.();
}
