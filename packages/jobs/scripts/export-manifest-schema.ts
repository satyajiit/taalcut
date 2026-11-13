// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writes tools/components/manifest.schema.json from the zod schema.
 * Run after changing src/components/manifest.ts:
 *
 *   pnpm --filter @taalcut/jobs run schema:export
 *
 * test/manifest.test.ts fails when the committed file is out of date.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { manifestJsonSchema } from '../src/index';

const target = fileURLToPath(new URL('../../../tools/components/manifest.schema.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`);
process.stdout.write(`Wrote ${target}\n`);
