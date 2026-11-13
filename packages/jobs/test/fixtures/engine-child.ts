// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Child process for the kill -9 test. Runs a job engine over a file-backed
 * store and reports, synchronously on stdout, each step it finishes and each
 * progress value it has saved to disk. It holds after step <hold> until the
 * parent SIGKILLs it, and its lease is long, so a slow machine can't change
 * what is on disk when it dies.
 *
 *   node --import tsx engine-child.ts <store file> <hold>
 */
import { writeSync } from 'node:fs';
import { createJobEngine } from '../../src/index';
import { fileBackedStore, LONG_LEASE_MS, stepJob } from './step-job';

/** Synchronous write to fd 1, so a line is never sitting in a JS buffer when the process dies. */
function say(line: string): void {
  const bytes = Buffer.from(`${line}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    try {
      offset += writeSync(1, bytes, offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') throw error;
    }
  }
}

let lastSaved = 0;
const store = fileBackedStore(process.argv[2]!, (records) => {
  const step = (records[0]?.progressDetail as { step?: number } | null)?.step ?? 0;
  if (step > lastSaved) say(`saved ${(lastSaved = step)}`);
});
const engine = createJobEngine({
  store,
  bootId: `child:${process.pid}`,
  leaseMs: LONG_LEASE_MS,
  heartbeatMs: 40,
  pollMs: 20,
  progressIntervalMs: 20,
});
engine.register(stepJob((step) => say(`step ${step}`), 25, Number(process.argv[3])));
await engine.start();
say('ready');
