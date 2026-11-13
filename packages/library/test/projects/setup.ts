// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Core's command bus over the library's ports with the project commands registered, as the agent root does. */
import {
  createCommandBus,
  createEventBus,
  unwrap,
  type CommandOrigin,
  type TaalcutEvent,
} from '@taalcut/core';
import {
  createLibraryPorts,
  createProjectCommands,
  createRepositories,
  createTimelineStore,
  type LibraryDatabase,
} from '../../src/index';
import { openTestDb } from '../helpers';
import { seed, timeline } from '../stores/documents';

export const ui: CommandOrigin = { source: 'ui', actor: 'user' };

export function projectsSetup(db: LibraryDatabase = tickingDb()) {
  const ports = createLibraryPorts(db);
  const repos = createRepositories(db);
  const timelines = createTimelineStore(db, { commands: ports.commands });
  let now = Date.UTC(2026, 9, 12);
  const clock = { now: () => (now += 1) };
  const bus = createCommandBus({ store: ports.auditLog, clock });
  const events = createEventBus({ clock });
  const commands = createProjectCommands({
    projects: repos.projects,
    timelines,
    commands: ports.commands,
    settings: ports.settings,
    clock: clock.now,
  });
  bus.register(...commands.all);
  commands.announce(bus, events);
  const seen: TaalcutEvent[] = [];
  events.onAny((event) => seen.push(event), ['library.changed']);
  return { db, ports, repos, timelines, bus, events, commands, seen };
}

/** A clock that moves 1 ms per read, so "most recent" is never a tie. */
export function tickingDb(): LibraryDatabase {
  let now = Date.UTC(2026, 9, 12);
  return openTestDb({ file: false, clock: () => (now += 1) });
}

/** A project with a timeline in it. */
export async function projectWithTimeline(setup: ReturnType<typeof projectsSetup>) {
  const { project, assets } = seed(setup.db);
  const doc = timeline(project.id, assets);
  unwrap(await setup.timelines.create(doc));
  return { project, assets, doc };
}
