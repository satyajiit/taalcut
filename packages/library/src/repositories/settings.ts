// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings (JSON values by key) and warning-card acknowledgements (PRD 10.1).
 * Neither may hold secrets: tokens and keys live in the OS keychain.
 */
import { err, newId, ok, ValidationError, type Result } from '@taalcut/core';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { ZodType } from 'zod';
import type { LibraryDatabase } from '../db/database';
import type { AcknowledgementId } from '../ids';
import { acknowledgements, settings } from '../schema/settings';
import { containsSecret } from '../secrets/redact';
import { checkStorableJson } from './models';
import { attemptWrite, inTransaction } from './shared';

export type Acknowledgement = typeof acknowledgements.$inferSelect;

export interface SettingsRepository {
  /** undefined if unset; ValidationError if the stored value no longer matches `schema`. */
  get<T>(key: string, schema: ZodType<T>): Result<T | undefined>;
  /** ValidationError for a bad key, or a value that isn't plain JSON, holds a secret or exceeds 256 KB. */
  set(key: string, value: unknown): Result<void>;
  /** What `set` would refuse, without writing: for writes staged to run later (a command's unit of work). */
  check(key: string, value: unknown): Result<void>;
  /** True if a value was removed. */
  delete(key: string): Result<boolean>;
  all(): Record<string, unknown>;
}

export interface AcknowledgementRepository {
  /**
   * Records "I understand" for a feature and terms version, at `at` (default
   * now). Recording the same pair again returns the first record.
   */
  record(input: {
    featureId: string;
    termsVersion: string;
    at?: number;
    context?: unknown;
  }): Result<Acknowledgement>;
  /** Whether the card can be skipped: the user acknowledged exactly this terms version. */
  has(featureId: string, termsVersion: string): boolean;
  /** The most recent acknowledgement of a feature, any terms version. */
  latest(featureId: string): Acknowledgement | undefined;
  list(): Acknowledgement[];
}

const MAX_SETTING_BYTES = 256_000;

const KEY = /^[a-z][a-zA-Z0-9]*([._-][a-zA-Z0-9]+)*$/;

/** A key that looks like a secret is refused too. A rejected key is not echoed: it may be a token. */
function checkKey(key: string): Result<string> {
  return KEY.test(key) && !containsSecret(key) ? ok(key) : err(ValidationError({ field: 'key' }));
}

export function createSettingsRepository(db: LibraryDatabase): SettingsRepository {
  const { orm } = db;
  return {
    get(key, schema) {
      const row = orm.select().from(settings).where(eq(settings.key, key)).get();
      if (!row) return ok(undefined);
      const parsed = schema.safeParse(row.value);
      return parsed.success
        ? ok(parsed.data)
        : err(ValidationError({ field: key }, { detail: parsed.error.message }));
    },
    check(key, value) {
      const valid = checkKey(key);
      if (!valid.ok) return valid;
      const storable = checkStorableJson(key, value, MAX_SETTING_BYTES);
      return storable.ok ? ok(undefined) : storable;
    },
    set(key, value) {
      const valid = checkKey(key);
      if (!valid.ok) return valid;
      const storable = checkStorableJson(key, value, MAX_SETTING_BYTES);
      if (!storable.ok) return storable;
      // JSON null must be the text 'null': SQL NULL would break the NOT NULL column.
      const row = { key, value: value === null ? sql`'null'` : value, updatedAt: db.clock() };
      return attemptWrite(db, 'setting', () => {
        orm
          .insert(settings)
          .values(row)
          .onConflictDoUpdate({ target: settings.key, set: { value: row.value, updatedAt: row.updatedAt } })
          .run();
      });
    },
    delete(key) {
      return attemptWrite(
        db,
        'setting',
        () => orm.delete(settings).where(eq(settings.key, key)).run().changes > 0,
      );
    },
    all() {
      const rows = orm.select().from(settings).orderBy(asc(settings.key)).all();
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
  };
}

export function createAcknowledgementRepository(db: LibraryDatabase): AcknowledgementRepository {
  const { orm } = db;
  const find = (featureId: string, termsVersion: string) =>
    orm
      .select()
      .from(acknowledgements)
      .where(and(eq(acknowledgements.featureId, featureId), eq(acknowledgements.termsVersion, termsVersion)))
      .get();
  return {
    record(input) {
      if (!input.featureId.trim()) return err(ValidationError({ field: 'featureId' }));
      if (!input.termsVersion.trim()) return err(ValidationError({ field: 'termsVersion' }));
      if (input.at !== undefined && !(Number.isSafeInteger(input.at) && input.at >= 0)) {
        return err(ValidationError({ field: 'at' }));
      }
      if (input.context !== undefined) {
        const storable = checkStorableJson('context', input.context, MAX_SETTING_BYTES);
        if (!storable.ok) return storable;
      }
      return inTransaction(db, 'acknowledgement', () => {
        const existing = find(input.featureId, input.termsVersion);
        if (existing) return ok(existing);
        const row: Acknowledgement = {
          id: newId<'Acknowledgement'>() as AcknowledgementId,
          featureId: input.featureId,
          termsVersion: input.termsVersion,
          acknowledgedAt: input.at ?? db.clock(),
          context: input.context ?? null,
        };
        return ok(orm.insert(acknowledgements).values(row).returning().get());
      });
    },
    has: (featureId, termsVersion) => find(featureId, termsVersion) !== undefined,
    latest: (featureId) =>
      orm
        .select()
        .from(acknowledgements)
        .where(eq(acknowledgements.featureId, featureId))
        .orderBy(desc(acknowledgements.acknowledgedAt), desc(acknowledgements.id))
        .get(),
    list: () => orm.select().from(acknowledgements).orderBy(asc(acknowledgements.acknowledgedAt)).all(),
  };
}
