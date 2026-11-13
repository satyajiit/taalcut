// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for the jobs process in server-spawn.test.ts: it starts a "server" (a sleep) the way the pool starts
 * whisper-server, prints its pid as JSON, and then either waits to be killed without cleaning up (the
 * indexing-durability e2e's kill -9), or with `exit` exits at once without stopping it (a quit whose shutdown never
 * reached the pool).
 *
 *   node --import tsx server-parent.ts [exit]
 */
import { tmpdir } from 'node:os';
import { posixServerSpawn } from '../../src/whisper/server-spawn';

const server = posixServerSpawn({
  command: '/bin/sleep',
  args: ['60'],
  cwd: tmpdir(),
  onLine: () => undefined,
});
const exitAtOnce = process.argv.includes('exit');
process.stdout.write(`${JSON.stringify({ server: server.pid })}\n`, () => {
  if (exitAtOnce) process.exit(0);
});
setInterval(() => undefined, 60_000);
