// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B1 (hardening): what the daily purge of generated files costs on a large library, for the decision in the
 * library SPEC ("Generated files"). The purge reads timeline documents only for kept files no clip refers to,
 * and stops as soon as each has been seen; this measures the three cases on 500 timelines of about 100 KB, each
 * with 4 saved versions (2,500 documents, about 250 MB): every kept file in a clip (no document read), one
 * mentioned in the first working copy read (stops at once), and one mentioned nowhere (reads every document).
 * A benchmark, not a correctness test: it runs with TAALCUT_BENCH=1.
 */
import { newId, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { purgeGenerated, type LibraryDatabase } from '../../src/index';
import { image, setup, timeline } from './fixture';

const bench = process.env.TAALCUT_BENCH === '1';
const TIMELINES = 500;
const VERSIONS = 4;
const DOCUMENT_BYTES = 100_000;

/** A timeline-like document of about DOCUMENT_BYTES: clips naming ids, as a real one does. */
function bigDocument(mention?: AssetId): object {
  const clips = [];
  let size = 0;
  while (size < DOCUMENT_BYTES) {
    const clip = {
      id: newId<'Clip'>(),
      asset: newId<'Asset'>(),
      shot: newId<'Shot'>(),
      text: 'a word '.repeat(20),
    };
    size += JSON.stringify(clip).length;
    clips.push(clip);
  }
  return { tracks: [{ items: clips }], voice: mention ? [{ asset: mention }] : [] };
}

function addVersions(db: LibraryDatabase, timelineId: string): void {
  const document = JSON.stringify(bigDocument());
  for (let number = 1; number <= VERSIONS; number++) {
    db.driver
      .prepare(
        `INSERT INTO timeline_versions (id, timeline_id, number, kind, schema_version, document, revision,
           document_hash, created_at) VALUES (?, ?, ?, 'auto', 2, ?, ?, ?, 1)`,
      )
      .run(newId<'TimelineVersion'>(), timelineId, number, document, number, 'c'.repeat(64));
  }
}

async function timedPurge(db: LibraryDatabase): Promise<number> {
  const start = performance.now();
  unwrap(await purgeGenerated({ db }));
  return Math.round(performance.now() - start);
}

describe.skipIf(!bench)('generated purge at scale', { timeout: 600_000 }, () => {
  it(`marks references over ${TIMELINES} timelines with ${VERSIONS} versions each`, async () => {
    const env = setup();
    const placed = unwrap(await env.sink.put(image('placed take')));
    const loose = unwrap(await env.sink.put(image('loose take')));
    const ids: string[] = [];
    env.db.transaction(() => {
      for (let i = 0; i < TIMELINES; i++) {
        const id = timeline(env.db, bigDocument(), i === 0 ? placed.assetId : undefined);
        ids.push(id);
        addVersions(env.db, id);
      }
    });
    env.db.driver.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const megabytes =
      Number(
        env.db.driver
          .prepare(
            `SELECT (SELECT sum(length(document)) FROM timelines) + (SELECT sum(length(document)) FROM timeline_versions)
             AS bytes`,
          )
          .get()?.bytes,
      ) / 1e6;

    // One kept file has no clip: every document is read, and none mentions it.
    const unmentioned = await timedPurge(env.db);

    // Now the first working copy the scan reads mentions it: the scan stops on its first page.
    const first = [...ids].sort()[0] ?? '';
    env.db.driver
      .prepare('UPDATE timelines SET document = ? WHERE id = ?')
      .run(JSON.stringify(bigDocument(loose.assetId)), first);
    const mentionedFirst = await timedPurge(env.db);

    // Every kept file is in a clip: no document is read.
    env.db.driver
      .prepare('INSERT INTO timeline_asset_refs (timeline_id, asset_id) VALUES (?, ?)')
      .run(first, loose.assetId);
    const allPlaced = await timedPurge(env.db);

    const report = {
      documents: TIMELINES * (VERSIONS + 1),
      megabytes: Math.round(megabytes),
      unmentioned,
      mentionedFirst,
      allPlaced,
    };
    process.stdout.write(`[purge-bench] ${JSON.stringify(report)}\n`);
    expect(report.documents).toBe(2500);
  });
});
