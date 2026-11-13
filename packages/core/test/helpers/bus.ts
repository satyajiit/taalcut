// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Composes a command bus the way a process's composition root does, with fakes swapped in by token. */
import {
  AuditLogStoreToken,
  ClockToken,
  CommandBusToken,
  createCommandBus,
  createContainer,
  createManualClock,
  createMemoryAuditLogStore,
  type AuditLogStore,
  type CommandOrigin,
} from '@taalcut/core';
import { createMemoryProjects, createProjectRenameCommand } from './projects';

export const UI: CommandOrigin = { source: 'ui', actor: 'user' };

export function setupBus(
  options: { names?: string[]; store?: (memory: AuditLogStore) => AuditLogStore } = {},
) {
  const projects = createMemoryProjects(...(options.names ?? ['Untitled']));
  const memory = createMemoryAuditLogStore();
  const clock = createManualClock(1_000);
  const container = createContainer()
    .value(ClockToken, clock)
    .value(AuditLogStoreToken, options.store ? options.store(memory) : memory)
    .factory(CommandBusToken, createCommandBus, { deps: { store: AuditLogStoreToken, clock: ClockToken } });
  const bus = container.resolve(CommandBusToken);
  const rename = createProjectRenameCommand({ projects: projects.repository });
  bus.register(rename);
  return { bus, store: memory, clock, projects, rename, projectId: projects.ids[0]!, container };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
