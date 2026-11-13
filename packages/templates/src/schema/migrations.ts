// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stored template JSON → the current Template (P2-T1). `schemaVersion` is the
 * document's shape; `version` is its content. Every read goes through the
 * chain: TEMPLATE_MIGRATIONS[n] turns version-n JSON into version n + 1, and
 * the result is validated by the current schema. A newer shape than this build
 * knows is refused, never guessed at. A migrated document is written back only
 * as part of a new version (the store keeps what it stored).
 */
import {
  err,
  ok,
  TEMPLATE_SCHEMA_VERSION,
  templateSchema,
  ValidationError,
  type Result,
  type Template,
} from '@taalcut/core';
import { z } from 'zod';
import { UnsupportedSchema } from '../errors';

/** One step: version-n JSON (already parsed) to version n + 1 JSON. Pure, never throws on good input. */
export type TemplateMigration = (json: Record<string, unknown>) => Record<string, unknown>;

/** v1 ships an empty chain. The machinery is tested with a synthetic v2. */
export const TEMPLATE_MIGRATIONS: Readonly<Record<number, TemplateMigration>> = Object.freeze({});

export interface Migrator<T> {
  /** The shape this build reads and writes. */
  readonly current: number;
  migrate(json: unknown, schemaVersion: number): Result<T>;
}

/**
 * A migrator over any chain and target schema, so a future v2 (and the tests'
 * synthetic one) use the same code as v1.
 */
export function createMigrator<T>(options: {
  readonly current: number;
  readonly migrations: Readonly<Record<number, TemplateMigration>>;
  readonly schema: z.ZodType<T>;
}): Migrator<T> {
  const { current, migrations, schema } = options;
  return {
    current,
    migrate(json, schemaVersion) {
      if (!Number.isInteger(schemaVersion) || schemaVersion < 1)
        return err(ValidationError({ field: 'schemaVersion' }, { detail: `schemaVersion ${schemaVersion}` }));
      if (schemaVersion > current) return err(UnsupportedSchema({ schemaVersion }));
      if (typeof json !== 'object' || json === null || Array.isArray(json))
        return err(ValidationError({ field: 'template' }, { detail: 'A stored template is a JSON object' }));
      const stated = (json as { schemaVersion?: unknown }).schemaVersion;
      if (stated !== schemaVersion)
        return err(
          ValidationError(
            { field: 'schemaVersion' },
            { detail: `Stored as ${String(stated)}, labelled ${schemaVersion}` },
          ),
        );
      let document = json as Record<string, unknown>;
      for (let from = schemaVersion; from < current; from++) {
        const step = migrations[from];
        // A gap in the chain is a build bug; refuse the document rather than read it wrongly.
        if (!step) return err(UnsupportedSchema({ schemaVersion }, { detail: `No migration from ${from}` }));
        document = { ...step(structuredClone(document)), schemaVersion: from + 1 };
      }
      const parsed = schema.safeParse(document);
      if (!parsed.success)
        return err(ValidationError({ field: 'template' }, { detail: z.prettifyError(parsed.error) }));
      return ok(parsed.data);
    },
  };
}

const templateMigrator = createMigrator<Template>({
  current: TEMPLATE_SCHEMA_VERSION,
  migrations: TEMPLATE_MIGRATIONS,
  schema: templateSchema,
});

/** Reads a stored document through the registered chain, then templateSchema. */
export function migrateTemplate(json: unknown, schemaVersion: number): Result<Template> {
  return templateMigrator.migrate(json, schemaVersion);
}
