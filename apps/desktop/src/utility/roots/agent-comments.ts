// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT in the agent process: the library's comment store (core's CommentStoreToken), its commands on the bus, the
 * `comments` namespace the editor reads and watches, the `comments` tools the Editor answers a batch with, and the
 * chat service's batches. Each joins its root with one line (agent-root.ts, agent-launch.ts, agent-loop.ts).
 */
import {
  ClockToken,
  CommandBusToken,
  CommentStoreToken,
  commentsRouter,
  createToken,
  EventBusToken,
  TimelineStoreToken,
  type AnyCommand,
  type CommentBatchPort,
  type Container,
  type ToolModule,
} from '@taalcut/core';
import {
  commentToolModule,
  createCommentBatches,
  createCommentCommands,
  createCommentsService,
  createCommentStore,
  type CommentCommands,
} from '@taalcut/library';
import { LibraryDatabaseToken, LibraryPortsToken } from '../../shared/tokens';

const CommentCommandsToken = createToken<CommentCommands>('desktop.commentCommands');

export function registerAgentComments(container: Container): void {
  container.factory(
    CommentStoreToken,
    ({ db, ports }) => createCommentStore(db, { commands: ports.commands }),
    { deps: { db: LibraryDatabaseToken, ports: LibraryPortsToken } },
  );
  container.factory(
    CommentCommandsToken,
    ({ store, timelines, clock }) => createCommentCommands({ store, timelines, clock }),
    { deps: { store: CommentStoreToken, timelines: TimelineStoreToken, clock: ClockToken } },
  );
}

/** COMMENT_COMMANDS, with `library.changed` once each commits. */
export function commentCommands(container: Container): AnyCommand[] {
  if (!container.has(CommentCommandsToken)) return [];
  const commands = container.resolve(CommentCommandsToken);
  commands.announce(container.resolve(CommandBusToken), container.resolve(EventBusToken));
  return commands.all;
}

/** comments.list and comments.reply. */
export function commentToolModules(container: Container): ToolModule[] {
  if (!container.has(CommentStoreToken)) return [];
  return [
    commentToolModule({
      store: container.resolve(CommentStoreToken),
      timelines: container.resolve(TimelineStoreToken),
    }),
  ];
}

/** createChatService's `comments`: a message's comments read into a batch, sent to its run and given back after. */
export function commentChatDeps(container: Container): { readonly comments?: CommentBatchPort } {
  if (!container.has(CommentStoreToken)) return {};
  return {
    comments: createCommentBatches({
      store: container.resolve(CommentStoreToken),
      timelines: container.resolve(TimelineStoreToken),
      bus: container.resolve(CommandBusToken),
    }),
  };
}

/** appContract.comments: the editor's comments and their watch. */
export function agentCommentsRouter(container: Container) {
  return commentsRouter(
    createCommentsService({
      store: container.resolve(CommentStoreToken),
      timelines: container.resolve(TimelineStoreToken),
      events: container.resolve(EventBusToken),
    }),
  );
}
