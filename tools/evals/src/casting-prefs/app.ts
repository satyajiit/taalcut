// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent process's casting and memory as the simulated creator meets them (LRN1-PREF eval), composed the way
 * apps/desktop's agent root composes them over a library database: core's command bus over the library's audit log,
 * @taalcut/timeline's commands over the library's timeline store, the library's memory store and commands, the
 * casting engine reading its weights per cast from the learned item (learnedCastingConfig), and the learning job
 * (createCastingLearner) reading every project's history. A video is a project with one assembled timeline the
 * agent created; the creator's swaps and removals are timeline commands from the UI, recorded by the bus.
 *
 * The world's shots are in the library's assets (a timeline's media must be) and in a memory shot catalogue for casting,
 * as profiles; the one stand-in is the embedder (the casting eval's feature hashing). The job runs when the simulation says so,
 * where the app runs it a few seconds after a burst of swaps (followCastingSignals).
 */
import {
  createCommandBus,
  createEventBus,
  createManualClock,
  ok,
  unwrap,
  type AuditEntry,
  type CommandBus,
  type CommandOrigin,
  type ManualClock,
  type MemoryStore,
  type ProjectId,
  type Template,
  type Timeline,
} from '@taalcut/core';
import {
  createCommandUnitOfWork,
  createMemoryCommands,
  createMemoryStore,
  createRepositories,
  createSettingsStore,
  createTimelineStore,
  openDatabase,
  type LibraryDatabase,
} from '@taalcut/library';
import {
  assemble,
  createCastingEngine,
  createCastingLearner,
  createMemoryShotCatalog,
  createTimelineCommands,
  learnedCastingConfig,
  type CastingEngine,
  type CastingLearner,
  type CastResult,
} from '@taalcut/timeline';
import { hashingEmbedder } from '../casting/library';
import { worldId, type PrefWorld } from './world';

/** The agent's own commands (assembly) and the person's (swaps, removals in the editor). */
export const AGENT: CommandOrigin = { source: 'agent', actor: 'agent' };
export const PERSON: CommandOrigin = { source: 'ui', actor: 'person' };

/** Each command a second after the last, so the log's order is the order things happened. */
const STEP_MS = 1_000;
const START_MS = Date.UTC(2026, 9, 1);

export interface Video {
  readonly projectId: ProjectId;
  readonly timeline: Timeline;
  readonly cast: CastResult;
}

export interface PrefApp {
  readonly db: LibraryDatabase;
  readonly bus: CommandBus;
  readonly clock: ManualClock;
  readonly engine: CastingEngine;
  readonly learner: CastingLearner;
  readonly memory: MemoryStore;
  /** Every entry of every project's history and the app-wide one, oldest first. */
  log(): Promise<AuditEntry[]>;
  /** Casts `template` for a new project and assembles it, as the agent would. */
  video(template: Template, n: number): Promise<Video>;
  /** Dispatches by name after one step of the clock. */
  dispatch(name: string, payload: unknown, origin: CommandOrigin): ReturnType<CommandBus['dispatch']>;
  close(): void;
}

export function openPrefApp(world: PrefWorld): PrefApp {
  const db = unwrap(openDatabase({ path: ':memory:' }));
  const clock = createManualClock(START_MS);
  const units = createCommandUnitOfWork(db);
  const bus = createCommandBus({ store: units.auditLog, clock });
  const catalog = createMemoryShotCatalog([...world.profiles]);
  const timelines = createTimelineStore(db, { commands: units });
  bus.register(
    ...createTimelineCommands({ store: timelines, events: createEventBus({ clock }), clock, catalog }).all,
  );
  const memory = createMemoryStore(db, { commands: units });
  const settings = createSettingsStore(db, { commands: units });
  bus.register(...createMemoryCommands({ store: memory, settings, clock }).all);
  const repositories = createRepositories(db);
  // The world's files as the library knows them, so a timeline may use them (its asset references).
  db.transaction(() =>
    world.profiles.forEach((profile, index) =>
      unwrap(
        repositories.assets.create({
          id: profile.assetId,
          kind: 'video',
          sizeBytes: 1_000_000 + index,
          originalFilename: `shot-${index}.mov`,
        }),
      ),
    ),
  );
  const projects: ProjectId[] = [];
  const engine = createCastingEngine({
    catalog,
    embedder: hashingEmbedder(),
    configSource: learnedCastingConfig({ store: memory }),
  });

  const entries = (names: ReadonlySet<string> | null): AuditEntry[] => {
    const found: AuditEntry[] = [];
    for (const scope of [null, ...projects]) {
      const listed = unwrap(repositories.auditLog.listByProject(scope));
      found.push(...listed.filter((entry) => names === null || names.has(entry.name)));
    }
    return found.sort((a, b) => a.createdAt - b.createdAt);
  };
  const learner = createCastingLearner({
    log: { entries: async (names) => ok(entries(new Set(names))) },
    store: memory,
    commands: bus,
  });
  const dispatch = (name: string, payload: unknown, origin: CommandOrigin) => {
    clock.advance(STEP_MS);
    return bus.dispatch(name, payload, origin);
  };
  let items = 0;

  return {
    db,
    bus,
    clock,
    engine,
    learner,
    memory,
    log: async () => entries(null),
    async video(template, n) {
      const project = unwrap(repositories.projects.create({ name: `Video ${n}` }));
      projects.push(project.id);
      const cast = unwrap(
        await engine.cast({ projectId: project.id, template, mode: 'template', variants: 1, seed: 1 }),
      );
      const variant = cast.variants[0];
      if (!variant) throw new Error(`video ${n}: no variant`);
      const timeline = unwrap(
        assemble(
          {
            projectId: project.id,
            template,
            variant,
            cast: {
              castId: cast.castId,
              mode: cast.mode,
              variantIndex: 0,
              variantCount: cast.variants.length,
              configVersion: cast.configVersion,
            },
            timelineId: worldId<'Timeline'>(5, n),
            name: `Video ${n}`,
            now: clock.now(),
          },
          { item: () => worldId<'TimelineItem'>(6, items++) },
        ),
      );
      unwrap(await dispatch('timeline.create', { projectId: project.id, timelines: [timeline] }, AGENT));
      return { projectId: project.id, timeline, cast };
    },
    dispatch,
    close: () => db.close(),
  };
}
