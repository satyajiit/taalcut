// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writes packages/library/SCHEMA.md from the migrations.
 *
 *   pnpm --filter @taalcut/library schema:doc            regenerate
 *   pnpm --filter @taalcut/library schema:doc --check    exit 1 if SCHEMA.md is stale (CI)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { renderSchemaDoc, SCHEMA_DOC_PATH } from './render-schema-doc';

const doc = await renderSchemaDoc();

if (process.argv.includes('--check')) {
  const current = existsSync(SCHEMA_DOC_PATH) ? readFileSync(SCHEMA_DOC_PATH, 'utf8') : '';
  if (current !== doc) {
    process.stderr.write('SCHEMA.md is stale. Run `pnpm --filter @taalcut/library schema:doc`.\n');
    process.exit(1);
  }
  process.stdout.write('SCHEMA.md is up to date.\n');
} else {
  writeFileSync(SCHEMA_DOC_PATH, doc);
  process.stdout.write(`Wrote ${SCHEMA_DOC_PATH}\n`);
}
