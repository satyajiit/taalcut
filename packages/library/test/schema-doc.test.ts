// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** SCHEMA.md is generated; CI fails when someone changes a migration without regenerating it. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderSchemaDoc, SCHEMA_DOC_PATH } from '../scripts/render-schema-doc';

describe('SCHEMA.md', () => {
  it('matches the migrations (run `pnpm --filter @taalcut/library schema:doc` if this fails)', async () => {
    expect(readFileSync(SCHEMA_DOC_PATH, 'utf8')).toBe(await renderSchemaDoc());
  });

  it('documents every table with its SQL and indexes', async () => {
    const doc = await renderSchemaDoc();
    for (const table of ['commands', 'agent_events', 'jobs', 'cloud_calls', 'sources']) {
      expect(doc).toContain(`## ${table}`);
      // A table rebuilt by a migration keeps the quoted name SQLite gave it on rename.
      expect(doc).toMatch(new RegExp(`CREATE TABLE "?${table}"? \\(`));
    }
    expect(doc).toContain("`commands_scope_seq_uq` (unique) (coalesce(project_id, ''), seq)");
  });
});
