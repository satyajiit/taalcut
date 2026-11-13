// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What every project command handler shares: its dependencies, staging on
 * the command's unit of work, and the change notes announced after commit.
 * A handler wrapped with `handle` discards both when it fails or throws.
 */
import {
  createCommitAnnouncer,
  err,
  toTaalcutError,
  type CommandContext,
  type CommitAnnouncer,
  type CommittedChange,
  type CommandHandler,
  type Result,
  type SettingsStore,
} from '@taalcut/core';
import type { CommandUnitOfWork } from '../ports/unit-of-work';
import type { ProjectRepository } from '../repositories/projects';
import type { LibraryTimelineStore } from '../stores/timeline-store';

export interface ProjectCommandDeps {
  readonly projects: ProjectRepository;
  /** The library's TimelineStore, made with the same unit of work (`commands`). */
  readonly timelines: LibraryTimelineStore;
  /** createLibraryPorts(db).commands. */
  readonly commands: Pick<CommandUnitOfWork, 'stage' | 'discard'>;
  /** For the default cap a new project starts with (DEFAULT_PROJECT_CAP_SETTING). */
  readonly settings?: Pick<SettingsStore, 'get'>;
  /** Epoch ms for a restored document's `updatedAt`. Default Date.now. */
  readonly clock?: () => number;
}

export interface ProjectCommandKit {
  readonly deps: ProjectCommandDeps;
  readonly announcer: CommitAnnouncer;
  stage(context: CommandContext, write: () => Result<unknown>): Result<void>;
  /** Wraps a handler: a failure discards its staged writes and its change notes. */
  handle<P, R>(handler: CommandHandler<P, R>): CommandHandler<P, R>;
  note(context: CommandContext, change: CommittedChange): void;
}

export function createProjectCommandKit(deps: ProjectCommandDeps): ProjectCommandKit {
  const announcer = createCommitAnnouncer();
  const fail = (context: CommandContext) => {
    deps.commands.discard(context);
    announcer.drop(context);
  };
  return {
    deps,
    announcer,
    stage: (context, write) => deps.commands.stage(context, write),
    note: (context, change) => announcer.note(context, change),
    handle(handler) {
      return async (payload, context) => {
        try {
          const outcome = await handler(payload, context);
          if (!outcome.ok) fail(context);
          return outcome;
        } catch (cause) {
          fail(context);
          return err(toTaalcutError(cause));
        }
      };
    },
  };
}
