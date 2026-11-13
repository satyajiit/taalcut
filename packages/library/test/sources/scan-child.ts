// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Child process for the scan resume test: scans a source in batches of 3 and
 * SIGKILLs itself while reading the `killAt`-th file, as a quit or a crash
 * would stop the jobs process.
 *
 *   node --import tsx scan-child.ts <db path> <source id> <killAt>
 */
import { unwrap, type SourceId } from '@taalcut/core';
import {
  createWasmContentHasher,
  openDatabase,
  scanSource,
  type ContentHasher,
  type VolumeProbe,
} from '../../src/index';

// The fixture's volume, inline: the fixture imports vitest, which a plain child process can't.
const volumes: VolumeProbe = {
  identify: async () => ({ uuid: 'VOL-1', name: 'Disk', mountPoint: '/' }),
  mountedUuids: async () => new Set(['VOL-1']),
};

const [path, sourceId, killAtText] = process.argv.slice(2);
const killAt = Number(killAtText);
const db = unwrap(openDatabase({ path: path!, integrityCheck: 'off' }));
const base = createWasmContentHasher();
let reads = 0;
const hasher: ContentHasher = {
  full: base.full,
  partial: async (file, options) => {
    if (++reads === killAt) process.kill(process.pid, 'SIGKILL');
    return base.partial(file, options);
  },
};
await scanSource({ db, hasher, volumes, batchSize: 3 }, { sourceId: sourceId as SourceId, mode: 'full' });
