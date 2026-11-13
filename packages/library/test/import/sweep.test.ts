// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * library.sweepStaging (P2-L3): an upload a crash left journalled is
 * imported; partials older than 7 days with no journal and old outcome
 * markers are deleted; fresh partials and a journal that doesn't parse stay.
 */
import { existsSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createLibraryJobs, STAGING_RETENTION_MS, sweepStaging } from '../../src/index';
import { importer, RECEIVED_AT } from './fixture';

const DAY = 24 * 60 * 60 * 1000;

describe('library.sweepStaging', () => {
  it('imports left-over journals and clears what no import will claim', async () => {
    const t = await importer();
    const now = RECEIVED_AT + 10 * DAY;
    const leftover = t.stage('left-over.mov').file;
    const old = (name: string, ageMs: number) => {
      const path = join(t.dir, name);
      writeFileSync(path, 'x');
      const at = (now - ageMs) / 1000;
      utimesSync(path, at, at);
      return path;
    };
    const stalePartial = old('01J9ZZZZZZZZZZZZZZZZZZZZZZ', STAGING_RETENTION_MS + DAY);
    const staleInfo = old('01J9ZZZZZZZZZZZZZZZZZZZZZZ.json', STAGING_RETENTION_MS + DAY);
    const freshPartial = old('01JA0000000000000000000000', DAY);
    const oldMarker = old('01J9YYYYYYYYYYYYYYYYYYYYYY.done.json', STAGING_RETENTION_MS + DAY);
    const broken = join(t.dir, '01J9XXXXXXXXXXXXXXXXXXXXXX.import.json');
    writeFileSync(broken, '{ not json');

    const result = unwrap(await sweepStaging(t.sink, { now: () => now }));
    expect(result).toEqual({ imported: 1, removed: 3 });
    expect(t.rows('SELECT original_filename FROM assets')).toEqual([{ original_filename: 'left-over.mov' }]);
    expect(existsSync(leftover.path)).toBe(false);
    for (const gone of [stalePartial, staleInfo, oldMarker]) expect(existsSync(gone)).toBe(false);
    expect(existsSync(freshPartial)).toBe(true);
    expect(existsSync(broken)).toBe(true);
  });

  it('runs as a job, and does nothing without an import sink in the process', async () => {
    const t = await importer();
    t.stage('job.mov');
    const jobs = createLibraryJobs({ db: t.db, importSink: t.sink });
    const sweep = jobs.find((j) => j.kind.kind === 'library.sweepStaging')!;
    const context = {
      jobId: 'j' as never,
      projectId: null,
      attempt: 1,
      signal: new AbortController().signal,
      progress: () => {},
    };
    expect(unwrap(await sweep.handler({}, context))).toEqual({ imported: 1, removed: 0 });
    const none = createLibraryJobs({ db: t.db }).find((j) => j.kind.kind === 'library.sweepStaging')!;
    expect(unwrap(await none.handler({}, context))).toEqual({ imported: 0, removed: 0 });
  });
});
