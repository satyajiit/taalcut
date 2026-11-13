// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  AuthoredProgramStoreToken,
  CommandBusToken,
  CreationStoreToken,
  EventBusToken,
  TimelineStoreToken,
  createCommitAnnouncer,
  err,
  toTaalcutError,
  type CommandContext,
  type CommandHandler,
  type Container,
} from '@taalcut/core';
import { createProjectRepository, LibraryDatabaseToken, LibraryPortsToken } from '@taalcut/library';

export function creationCommandKit(container: Container) {
  const commands = container.resolve(LibraryPortsToken).commands;
  const announcer = createCommitAnnouncer();
  announcer.attach(container.resolve(CommandBusToken), container.resolve(EventBusToken));
  return {
    store: container.resolve(CreationStoreToken),
    programs: container.resolve(AuthoredProgramStoreToken),
    timelines: container.resolve(TimelineStoreToken),
    projects: createProjectRepository(container.resolve(LibraryDatabaseToken)),
    stage: commands.stage,
    note(context: CommandContext, entity: 'project' | 'timeline', id: string) {
      announcer.note(context, { projectId: context.projectId, entity, change: 'updated', ids: [id] });
    },
    handle<P, R>(handler: CommandHandler<P, R>): CommandHandler<P, R> {
      return async (payload, context) => {
        try {
          const result = await handler(payload, context);
          if (!result.ok) {
            commands.discard(context);
            announcer.drop(context);
          }
          return result;
        } catch (cause) {
          commands.discard(context);
          announcer.drop(context);
          return err(toTaalcutError(cause));
        }
      };
    },
  };
}
export type CreationCommandKit = ReturnType<typeof creationCommandKit>;
