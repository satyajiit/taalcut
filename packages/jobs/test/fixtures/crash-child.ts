// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Child process for the crash-loop test: one boot of the app's jobs process.
 * An exclusive engine over the file-backed store (opened fresh, as a restart
 * reopens the database) takes over the dead boot's lease, then claims the job,
 * whose handler says so and hangs until the parent SIGKILLs the process, as a
 * job that keeps crashing it would.
 *
 *   node --import tsx crash-child.ts <store file>
 */
import { writeSync } from 'node:fs';
import { z } from 'zod';
import { createJobEngine, defineJob } from '../../src/index';
import { fileBackedStore, LONG_LEASE_MS } from './step-job';

const CRASH_JOB_KIND = 'test.crash';

/** Synchronous write to fd 1, so a line is never sitting in a JS buffer when the process dies. */
function say(line: string): void {
  writeSync(1, `${line}\n`);
}

const engine = createJobEngine({
  store: fileBackedStore(process.argv[2]!),
  bootId: `child:${process.pid}`,
  exclusive: true,
  log: (message) => say(`log ${message}`),
  leaseMs: LONG_LEASE_MS,
  pollMs: 20,
});
engine.register(
  defineJob({
    kind: CRASH_JOB_KIND,
    resourceClass: 'cpu',
    payload: z.object({}),
    handler: (_payload, _signal, _progress, context) => {
      say(`running ${context.attempt}`);
      return new Promise<never>(() => undefined);
    },
  }),
);
await engine.start();
say('ready');
