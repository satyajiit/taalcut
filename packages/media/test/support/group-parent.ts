// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for the jobs process in group-watchdog.test.ts: it starts a child in its own process group (which
 * starts one of its own), watches the group, prints both pids and the watchdog's as JSON, and waits to be killed
 * without cleaning up. With `release`, it lets go of the watchdog first.
 *
 *   node --import tsx group-parent.ts [release]
 */
import { spawn } from 'node:child_process';
import { watchProcessGroup } from '../../src/process/group-watchdog';

const child = spawn('/bin/sh', ['-c', '/bin/sleep 60 & echo "$$ $!"; wait'], {
  detached: true,
  stdio: ['ignore', 'pipe', 'ignore'],
});
const watchdog = watchProcessGroup(child.pid!);
if (process.argv.includes('release')) watchdog.release();
child.stdout.once('data', (chunk: Buffer) => {
  const [leader, grandchild] = chunk.toString('utf8').trim().split(' ').map(Number);
  process.stdout.write(`${JSON.stringify({ leader, grandchild, watchdog: watchdog.pid })}\n`);
});
setInterval(() => undefined, 60_000);
