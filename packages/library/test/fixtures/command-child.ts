// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Child process for the command crash test. Renames a project through core's
 * command bus and library's unit of work, acknowledging each command on
 * stdout after dispatch resolves. While committing rename number `killAt`, it
 * SIGKILLs itself inside the transaction: 'before' the rename (the audit row
 * is written, the change isn't) or 'after' it (both are written).
 *
 *   node --import tsx command-child.ts <db path> <killAt> <before|after>
 */
import { writeSync } from 'node:fs';
import { createCommandBus, systemClock, unwrap } from '@taalcut/core';
import { createCommandUnitOfWork, createRepositories, openDatabase } from '../../src/index';
import { renameCommand } from './rename-command';

function say(line: string): void {
  const bytes = Buffer.from(`${line}\n`);
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(1, bytes, offset);
}

const [path, killAtText, killPhase] = process.argv.slice(2);
const killAt = `name-${killAtText}`;
const db = unwrap(openDatabase({ path: path! }));
const repos = createRepositories(db);
const commands = createCommandUnitOfWork(db);
const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
const rename = renameCommand(repos, commands, (name, phase) => {
  if (name === killAt && phase === killPhase) process.kill(process.pid, 'SIGKILL');
});
bus.register(rename);
const project = unwrap(repos.projects.create({ name: 'name-0' }));
say(`project ${project.id}`);

for (let i = 1; ; i++) {
  const receipt = unwrap(
    await bus.dispatch(
      rename,
      { projectId: project.id, name: `name-${i}` },
      {
        source: 'ui',
        actor: 'user',
      },
    ),
  );
  say(`ack ${i} ${receipt.id}`);
}
