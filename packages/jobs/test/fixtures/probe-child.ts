// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Child process for the in-flight probe kill -9 test: an engine over a
 * file-backed store with the probe kind registered through fromJobKind. Its
 * handler starts the fake ffprobe, which waits for a release file that only
 * appears after this process is dead. Its lease is long, so nothing on disk
 * changes while the parent decides to kill it.
 *
 *   node --import tsx probe-child.ts <store file> <fake ffprobe dir>
 */
import { writeSync } from 'node:fs';
import { createJobEngine, fromJobKind } from '../../src/index';
import { fakeFfprobeIn, probeHandler, probeKind } from './probe-job';
import { fileBackedStore, LONG_LEASE_MS } from './step-job';

const engine = createJobEngine({
  store: fileBackedStore(process.argv[2]!),
  bootId: `child:${process.pid}`,
  leaseMs: LONG_LEASE_MS,
  heartbeatMs: 40,
  pollMs: 20,
});
engine.register(fromJobKind(probeKind, probeHandler(fakeFfprobeIn(process.argv[3]!))));
await engine.start();
writeSync(1, 'ready\n');
