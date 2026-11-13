// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  AuthoredProgramStoreToken,
  CommandBusToken,
  CREATION_COMMANDS,
  creationContract,
  creationRouter,
  createToken,
  CreationStoreToken,
  notServedRouter,
  ok,
  TimelineStoreToken,
  type Container,
  type ProjectId,
} from '@taalcut/core';
import { createCreationDirector } from '@taalcut/agent';
import { createCreationLogoService, createCreationSourceService } from '@taalcut/tools';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { creationCommands } from './commands';
import { creationCheckpointCommand, creationCheckpointStore } from './checkpoints';
import { creationModel } from './model';
import { creationMedia } from './production-media';
import { creationPublishCommand, publishCreation } from './publish';
import { readCreationProgram } from './programs';
import { creationSourceHost } from './sources';
import { registerCreationStores } from './stores';
import { createCreationVoice, estimateCreationVoice } from './voice';

const CreationLifetimeToken = createToken<{ stop(): Promise<void> }>('desktop.creationLifetime');

/** The desktop owns capabilities; the director only sees scoped source, model, audio and publication ports. */
export function registerCreation(container: Container, config: UtilityConfig) {
  registerCreationStores(container, config.userData);
  if (!container.has(CreationStoreToken))
    return {
      router: notServedRouter(creationContract, 'creation'),
      commands: [],
      start: async () => undefined,
    };
  const sourceHost = creationSourceHost(container, config);
  const commands = creationCommands(container, config.userData);
  const director = createCreationDirector({
    store: creationCheckpointStore(container, commands.store),
    model: creationModel(container),
    sources: createCreationSourceService(sourceHost),
    logos: createCreationLogoService(sourceHost),
    ...creationMedia(container),
    estimateVoice: (project, draft) => estimateCreationVoice(container, project, draft),
    voice: (project, draft, signal) => createCreationVoice(container, project, draft, signal),
    publish: (input, signal) => publishCreation(container, input, signal),
  });
  const report = (result: Awaited<ReturnType<typeof director.resume>>) => {
    if (!result.ok) console.warn(`[creation] ${result.error.code}`);
  };
  const running = new Set<ProjectId>();
  let stopping = false;
  function kick(projectId: ProjectId, action: 'prepare' | 'produce' | 'cancel' | 'resume' | 'retry') {
    if (stopping) return;
    running.add(projectId);
    void director[action](projectId)
      .then(report)
      .catch(() => {
        console.warn('[creation] Unexpected director failure');
      })
      .finally(() => running.delete(projectId));
  }
  container.factory(
    CreationLifetimeToken,
    () => ({
      async stop() {
        stopping = true;
        await Promise.all([...running].map((projectId) => director.cancel(projectId)));
      },
    }),
    { deps: { store: CreationStoreToken, bus: CommandBusToken }, dispose: (lifetime) => lifetime.stop() },
  );
  container.resolve(CreationLifetimeToken);
  container.resolve(CommandBusToken).subscribe((change) => {
    if (!change.projectId || change.kind === 'undone') return;
    const projectId = change.projectId;
    switch (change.name) {
      case CREATION_COMMANDS.research:
        kick(projectId, 'prepare');
        break;
      case CREATION_COMMANDS.approve:
      case CREATION_COMMANDS.produce:
        kick(projectId, 'produce');
        break;
      case CREATION_COMMANDS.cancel:
        kick(projectId, 'cancel');
        break;
      case CREATION_COMMANDS.resume:
        kick(projectId, 'resume');
        break;
      case CREATION_COMMANDS.retry:
        kick(projectId, 'retry');
        break;
    }
  });
  return {
    commands: [...commands.all, creationPublishCommand(container), creationCheckpointCommand(container)],
    router: creationRouter({
      async list() {
        const rows = await commands.store.list();
        return rows.ok ? ok({ items: [...rows.value] }) : rows;
      },
      get: ({ projectId }) => commands.store.get(projectId),
      async inspect(input) {
        const found = await readCreationProgram(
          container.resolve(AuthoredProgramStoreToken),
          container.resolve(TimelineStoreToken),
          input,
        );
        return found.ok ? ok(found.value.inspection) : found;
      },
    }),
    async start() {
      const rows = await commands.store.list();
      if (!rows.ok) {
        console.warn(`[creation] ${rows.error.code}`);
        return;
      }
      for (const row of rows.value) {
        // Resume durable work after restart. An unresolved charge becomes an explicit retry decision.
        if (row.status === 'researching' || row.status === 'producing') kick(row.projectId, 'resume');
      }
    },
  };
}
