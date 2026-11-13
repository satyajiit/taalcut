// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stored library for the study: a bench run's `index-library.sqlite` or a search eval's `library.db`. Stored
 * libraries are read-only inputs, so the file is copied into the study's work folder and only the copy is opened
 * (opening migrates and may write a recovery report). Each asset is known by its path in the footage set (its
 * location's relative path) and each shot by its range in seconds, which is what the labels name.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RationalTime, type ShotId, type VectorIndex } from '@taalcut/core';
import { openDatabase, openVectorIndex, sqliteVecPath, type LibraryDatabase } from '@taalcut/library';
import { EMBEDDING_SPACE } from '@taalcut/vision';
import { z } from 'zod';
import { setOfAssets } from './labels';
import type { StudySet } from './schema';

export interface StudyShot {
  readonly asset: string;
  readonly from: number;
  readonly to: number;
}

export interface StoredLibrary {
  readonly label: string;
  readonly set: StudySet;
  readonly db: LibraryDatabase;
  readonly vectors: VectorIndex;
  shot(id: ShotId): StudyShot | undefined;
  close(): void;
}

const shotRowSchema = z.object({
  id: z.string(),
  path: z.string(),
  start: z.int().nonnegative(),
  startNum: z.int().positive(),
  startDen: z.int().positive(),
  length: z.int().nonnegative(),
  lengthNum: z.int().positive(),
  lengthDen: z.int().positive(),
});

const seconds = (value: number, num: number, den: number) =>
  RationalTime.toSeconds({ value, rate: { num, den } });

/** Copies `source` into `workDir/<label>.sqlite` and opens the copy with its active embedding space. */
export function openStoredLibrary(label: string, source: string, workDir: string): StoredLibrary {
  mkdirSync(workDir, { recursive: true });
  const copy = join(workDir, `${label}.sqlite`);
  copyFileSync(source, copy);
  const opened = openDatabase({ path: copy, extensions: [sqliteVecPath()] });
  if (!opened.ok) throw new Error(`${source}: ${opened.error.code} ${opened.error.detail ?? ''}`);
  const db = opened.value;
  const vectors = openVectorIndex(db, {
    name: EMBEDDING_SPACE.indexName,
    dimensions: EMBEDDING_SPACE.dimensions,
  });
  if (!vectors.ok) {
    db.close();
    throw new Error(`${source}: no ${EMBEDDING_SPACE.indexName} vectors (${vectors.error.code})`);
  }
  const rows = db.driver
    .prepare(
      `SELECT s.id AS id, l.relative_path AS path,
              s.start_value AS start, s.start_rate_num AS startNum, s.start_rate_den AS startDen,
              s.duration_value AS length, s.duration_rate_num AS lengthNum, s.duration_rate_den AS lengthDen
         FROM shots s
         JOIN asset_locations l ON l.id = (SELECT id FROM asset_locations WHERE asset_id = s.asset_id LIMIT 1)`,
    )
    .all()
    .map((row) => shotRowSchema.parse(row));
  const shots = new Map<string, StudyShot>();
  for (const row of rows) {
    const from = seconds(row.start, row.startNum, row.startDen);
    shots.set(row.id, {
      asset: row.path,
      from,
      to: from + seconds(row.length, row.lengthNum, row.lengthDen),
    });
  }
  const set = setOfAssets([...new Set(rows.map((row) => row.path))]);
  return {
    label,
    set,
    db,
    vectors: vectors.value,
    shot: (id) => shots.get(id),
    close: () => db.close(),
  };
}
