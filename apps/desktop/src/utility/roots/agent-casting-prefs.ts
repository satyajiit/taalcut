// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Learned casting preferences in the agent process, the one that owns casting (LRN1-PREF, timeline SPEC "Learned
 * casting preferences"): the config source every cast, alternates and template fit resolve their weights from (the
 * casting config with the learned user-scope memory item's weights), and the learning job, which reads the command
 * audit log of every project, fits the weights and writes the item through the memory commands on the agent's bus.
 *
 * Joins agent-casting.ts (the engine), agent-template-index.ts (fit) and agent-root.ts (register, start) with new
 * lines only.
 */
import {
  CommandBusToken,
  createToken,
  MemoryStoreToken,
  ok,
  type AuditEntry,
  type Container,
  type ProjectId,
} from '@taalcut/core';
import { createRepositories, type LibraryDatabase } from '@taalcut/library';
import {
  createCastingLearner,
  followCastingSignals,
  learnedCastingConfig,
  type CastingConfigSource,
  type CastingLearner,
  type CastingSignalLog,
} from '@taalcut/timeline';
import { LibraryDatabaseToken } from '../../shared/tokens';

export const CastingConfigSourceToken = createToken<CastingConfigSource>('desktop.castingConfigSource');
const CastingLearnerToken = createToken<CastingLearner>('desktop.castingLearner');
const CastingSignalsToken = createToken<ReturnType<typeof followCastingSignals>>('desktop.castingSignals');

const warn = (message: string) => console.warn(`[casting] ${message}`);

/**
 * The audit log the learner reads: every project's history and the app-wide one (memory commands), only the named
 * commands. The library keeps each history's newest 10,000 entries in one read.
 */
export function librarySignalLog(db: LibraryDatabase): CastingSignalLog {
  const repositories = createRepositories(db);
  return {
    async entries(names) {
      const wanted = new Set(names);
      const scopes: (ProjectId | null)[] = [
        null,
        ...repositories.projects.list().map((project) => project.id),
      ];
      const found: AuditEntry[] = [];
      for (const scope of scopes) {
        const listed = repositories.auditLog.listByProject(scope);
        if (!listed.ok) return listed;
        for (const entry of listed.value) if (wanted.has(entry.name)) found.push(entry);
      }
      return ok(found);
    },
  };
}

export function registerCastingPrefs(container: Container): void {
  container.factory(CastingConfigSourceToken, ({ store }) => learnedCastingConfig({ store }), {
    deps: { store: MemoryStoreToken },
  });
  container.factory(
    CastingLearnerToken,
    ({ db, store, bus }) => createCastingLearner({ log: librarySignalLog(db), store, commands: bus }),
    { deps: { db: LibraryDatabaseToken, store: MemoryStoreToken, bus: CommandBusToken } },
  );
  container.factory(
    CastingSignalsToken,
    ({ bus, learner }) =>
      followCastingSignals(bus, learner, {
        onError: (error) => warn(`preferences not learned: ${error.code}`),
      }),
    {
      deps: { bus: CommandBusToken, learner: CastingLearnerToken },
      // Disposed before the database: no run starts after this, and the one under way finishes first.
      dispose: async (follower) => {
        follower.stop();
        await follower.idle();
      },
    },
  );
}

/** At start: learn once from what the log already holds, then a few seconds after each person's swap or removal. */
export async function startCastingPrefs(container: Container): Promise<void> {
  if (!container.has(CastingLearnerToken)) return;
  const first = await container.resolve(CastingLearnerToken).run();
  if (!first.ok) warn(`preferences not learned at start: ${first.error.code}`);
  container.resolve(CastingSignalsToken);
}
