// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Writes schema/template.v<n>.schema.json from templateSchema (P2-T1). test/json-schema.test.ts checks drift. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_JSON_SCHEMA_FILE, templateJsonSchema } from '../src/index';

const out = fileURLToPath(new URL(`../schema/${TEMPLATE_JSON_SCHEMA_FILE}`, import.meta.url));
writeFileSync(out, `${JSON.stringify(templateJsonSchema(), null, 2)}\n`);
process.stdout.write(`wrote ${out}\n`);
