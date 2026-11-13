// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Child process for the projects crash test. Saves named versions of a
 * timeline through core's bus and the project commands, acknowledging each
 * on stdout after dispatch resolves. While committing save number `killAt`
 * it SIGKILLs itself inside the transaction: 'before' the version row is
 * written (the audit row is) or 'after' it.
 *
 *   node --import tsx save-child.ts <db path> <killAt> <before|after>
 */
import { writeSync } from 'node:fs';
import { createCommandBus, systemClock, unwrap, type Result } from '@taalcut/core';
import {
  createLibraryPorts,
  createProjectCommands,
  createRepositories,
  createTimelineStore,
  openDatabase,
  type CommandUnitOfWork,
} from '../../src/index';
import { seed, timeline } from '../stores/documents';

function say(line: string): void {
  const bytes = Buffer.from(`${line}\n`);
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(1, bytes, offset);
}

const [path, killAtText, killPhase] = process.argv.slice(2);
const killAt = Number(killAtText);
const db = unwrap(openDatabase({ path: path! }));
const ports = createLibraryPorts(db);
let saving = 0;
/** The unit of work, with a kill switch around the staged write of save number `killAt`. */
const commands: Pick<CommandUnitOfWork, 'stage' | 'discard'> = {
  discard: (context) => ports.commands.discard(context),
  stage: (context, write) =>
    ports.commands.stage(context, (): Result<unknown> => {
      if (saving === killAt && killPhase === 'before') process.kill(process.pid, 'SIGKILL');
      const written = write();
      if (saving === killAt && killPhase === 'after') process.kill(process.pid, 'SIGKILL');
      return written;
    }),
};
const timelines = createTimelineStore(db, { commands: ports.commands });
const project = createProjectCommands({ projects: createRepositories(db).projects, timelines, commands });
const bus = createCommandBus({ store: ports.auditLog, clock: systemClock });
bus.register(...project.all);

const { project: row, assets } = seed(db);
const doc = timeline(row.id, assets);
unwrap(await timelines.create(doc));
say(`timeline ${row.id} ${doc.id}`);

for (let i = 1; ; i++) {
  saving = i;
  const receipt = unwrap(
    await bus.dispatch(
      project.saveVersion,
      { projectId: row.id, timelineId: doc.id, label: `save-${i}` },
      { source: 'ui', actor: 'user' },
    ),
  );
  say(`ack ${i} ${receipt.id}`);
}
