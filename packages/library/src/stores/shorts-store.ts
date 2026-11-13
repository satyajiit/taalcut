// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  err,
  ok,
  shortsRunSchema,
  ValidationError,
  type Result,
  type ShortsCache,
  type ShortsRun,
  type ShortsRunStore,
} from '@taalcut/core';
import { desc, eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { attemptWrite, inTransaction } from '../repositories/shared';
import { shortsAnalysisCache, shortsRuns } from './shorts-table';

const readRun = (value: unknown): Result<ShortsRun> => {
  const parsed = shortsRunSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(ValidationError({ field: 'shortsRun' }));
};

/** Derived run state checkpoints; the editable timeline itself is written through timeline commands. */
export function createShortsRunStore(db: LibraryDatabase): ShortsRunStore {
  return {
    async get(id) {
      const row = db.orm.select().from(shortsRuns).where(eq(shortsRuns.id, id)).get();
      return row ? readRun(row.document) : ok(null);
    },
    async put(run) {
      const parsed = readRun(run);
      if (!parsed.ok) return parsed;
      return inTransaction(db, 'shortsRun', () => {
        const previous = db.orm.select().from(shortsRuns).where(eq(shortsRuns.id, run.id)).get();
        if (
          previous &&
          (previous.projectId !== run.request.projectId || previous.updatedAt > run.updatedAt)
        ) {
          return err(ConflictError({ entity: 'shortsRun', id: run.id }));
        }
        db.orm
          .insert(shortsRuns)
          .values({
            id: run.id,
            projectId: run.request.projectId,
            document: parsed.value,
            updatedAt: run.updatedAt,
          })
          .onConflictDoUpdate({
            target: shortsRuns.id,
            set: { document: parsed.value, updatedAt: run.updatedAt },
          })
          .run();
        return ok(undefined);
      });
    },
    async list(projectId) {
      const rows = db.orm
        .select()
        .from(shortsRuns)
        .where(eq(shortsRuns.projectId, projectId))
        .orderBy(desc(shortsRuns.updatedAt))
        .all();
      const runs: ShortsRun[] = [];
      for (const row of rows) {
        const parsed = readRun(row.document);
        if (!parsed.ok) return parsed;
        runs.push(parsed.value);
      }
      return ok(runs);
    },
  };
}

/** Recomputable source/model evidence is isolated from durable editorial runs and template data. */
export function createShortsCache(db: LibraryDatabase): ShortsCache {
  return {
    async get(key) {
      const row = db.orm.select().from(shortsAnalysisCache).where(eq(shortsAnalysisCache.key, key)).get();
      return ok(row?.document ?? null);
    },
    async put(key, value) {
      let encoded: string | undefined;
      try {
        encoded = JSON.stringify(value);
      } catch {
        return err(ValidationError({ field: 'shortsCache' }));
      }
      if (key.length > 300 || !key.length || !encoded || encoded.length > 2_000_000) {
        return err(ValidationError({ field: 'shortsCache' }));
      }
      return attemptWrite(db, 'shortsCache', () => {
        const document = { document: value, updatedAt: db.clock() };
        db.orm
          .insert(shortsAnalysisCache)
          .values({ key, ...document })
          .onConflictDoUpdate({ target: shortsAnalysisCache.key, set: document })
          .run();
      });
    },
  };
}
