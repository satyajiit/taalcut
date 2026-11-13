// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A jobs process stand-in for the parent-death test (model-channels.test.ts, through media's standInParent): forks
 * the model child, opens its model, prints `{ model: <the child's pid> }` once the model is ready and then waits to
 * be killed.
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const child = fork(fileURLToPath(new URL('./model-child.ts', import.meta.url)), [], {
  execArgv: ['--import', 'tsx'],
  serialization: 'advanced',
});
child.on('message', (message) => {
  if ((message as { type?: unknown }).type === 'ready')
    process.stdout.write(`${JSON.stringify({ model: child.pid })}\n`);
});
child.send({ type: 'open', modelDir: '/unused' });
setInterval(() => undefined, 1000);
