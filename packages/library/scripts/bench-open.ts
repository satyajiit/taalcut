// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One open of an existing database in a fresh process, for bench.ts: prints
 * `{ "ms": … }`. A new process has no connection or statement cache; the OS
 * file cache stays warm (clearing it needs root).
 *
 *   node --import tsx scripts/bench-open.ts <db path> <quick|off>
 */
import { unwrap } from '@taalcut/core';
import { openDatabase, sqliteVecPath } from '../src/index';

const [path, check] = process.argv.slice(2);
const start = performance.now();
const db = unwrap(
  openDatabase({
    path: path!,
    extensions: [sqliteVecPath()],
    integrityCheck: check === 'off' ? 'off' : 'quick',
  }),
);
const ms = performance.now() - start;
db.close();
process.stdout.write(`${JSON.stringify({ ms })}\n`);
