// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for the app process in node-adapters.test.ts: it starts a
 * "sidecar" through createNodeSpawnPort that starts a child of its own,
 * prints both pids as JSON, and then waits to be killed without cleaning up.
 *
 *   node --import tsx spawn-parent.ts
 */
import { createNodeSpawnPort } from '@taalcut/models/node';

const port = createNodeSpawnPort();
const started = port.spawn({
  command: '/bin/sh',
  args: ['-c', '/bin/sleep 60 & echo "$$ $!"; wait'],
  env: {},
  onOutput: (line) => {
    const [sidecar, grandchild] = line.split(' ').map(Number);
    process.stdout.write(`${JSON.stringify({ sidecar, grandchild })}\n`);
  },
});
void started.exited;
setInterval(() => undefined, 60_000);
