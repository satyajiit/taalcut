// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B1 (hardening): how long TemplateStore.list takes on a large library, for the decisions in the library
 * SPEC ("Template list at scale"): the tags filter (json_each over each row's tags, no index) and the name sort.
 * One template is created through the store, then cloned with SQL into 5,000 and 20,000 lineages with five tags
 * each (the filtered tag is on 1 in 40, the missing one on none) and names in Latin and Hindi, a fifth of them
 * the same "Untitled". Each query runs 20 times; the median is printed.
 * A benchmark, not a correctness test: it runs with TAALCUT_BENCH=1 and only checks the answers.
 */
import { join } from 'node:path';
import { unwrap, type TemplateListQuery } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTemplateStore, type LibraryDatabase } from '../../src/index';
import { templateNameKeys } from '../../src/migrations/0024-template-name-keys';
import { openTestDb, tempDir } from '../helpers';
import { template } from './documents';

const bench = process.env.TAALCUT_BENCH === '1';
const RUNS = 20;
const base = { includeUnlisted: false, includeArchived: false, limit: 50 } as const;

/** Clones the one stored lineage into `count` more, with varied names and tags. */
function cloneLineages(db: LibraryDatabase, seedId: string, count: number): void {
  const versionColumns = db.driver
    .prepare("SELECT name FROM pragma_table_info('template_versions') WHERE name <> 'template_id'")
    .all()
    .map((row) => String(row.name))
    .join(', ');
  db.transaction(() => {
    db.driver
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
         INSERT INTO templates (id, name, listed, head_version, created_at, updated_at, tags, favourite)
         SELECT printf('B%025d', i),
                CASE i % 5 WHEN 0 THEN 'Árbol ' || i WHEN 1 THEN 'zebra ' || i WHEN 2 THEN 'Éclair ' || i
                  WHEN 3 THEN 'ग्राम ' || i ELSE 'Untitled' END,
                1, 1, i, i,
                json_array('t' || (i % 40), 'u' || (i % 13), 'v' || (i % 7), 'w' || (i % 3), 'x' || (i % 101)),
                i % 2
           FROM n`,
      )
      .run(count);
    db.driver
      .prepare(
        `INSERT INTO template_versions (template_id, ${versionColumns})
         SELECT t.id, ${versionColumns.replaceAll(/(\w+)/g, 'v.$1')}
           FROM templates t, template_versions v
          WHERE v.template_id = ? AND t.id <> v.template_id`,
      )
      .run(seedId);
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

async function timed(
  store: ReturnType<typeof createTemplateStore>,
  query: Partial<TemplateListQuery>,
): Promise<{ ms: number; items: number }> {
  const times: number[] = [];
  let items = 0;
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    items = unwrap(await store.list({ ...base, ...query })).items.length;
    times.push(performance.now() - start);
  }
  return { ms: Math.round(median(times) * 100) / 100, items };
}

describe.skipIf(!bench)('template list at scale', { timeout: 300_000 }, () => {
  for (const count of [5_000, 20_000]) {
    it(`lists ${count} lineages by tag and by name`, async () => {
      const db = openTestDb();
      const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
      const seeded = unwrap(await store.create(template(), { name: 'Seed', listed: true, projectId: null }));
      cloneLineages(db, seeded.id, count);
      // The clones bypassed the store: key their names as migration 24 does, and time that too.
      const fillStart = performance.now();
      db.transaction(() => templateNameKeys.fill?.(db.driver));
      const fillMs = Math.round(performance.now() - fillStart);
      db.driver.exec('ANALYZE');

      const report = {
        lineages: count + 1,
        migration24FillMs: fillMs,
        commonTag: await timed(store, { tags: ['t3'] }),
        commonTagByName: await timed(store, { tags: ['t3'], sort: 'name', dir: 'asc' }),
        missingTag: await timed(store, { tags: ['nobody'] }),
        nameAsc: await timed(store, { sort: 'name', dir: 'asc' }),
        nameDesc: await timed(store, { sort: 'name', dir: 'desc' }),
        updated: await timed(store, {}),
      };
      process.stdout.write(`[template-list-bench] ${JSON.stringify(report)}\n`);
      expect(report.commonTag.items).toBe(50);
      expect(report.missingTag.items).toBe(0);
      expect(report.nameAsc.items).toBe(50);
    });
  }
});
