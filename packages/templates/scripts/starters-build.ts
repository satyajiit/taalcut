// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writes starters/ and src/starters/bundled-documents.ts from starter-files.ts (P3-B3):
 * `pnpm --filter @taalcut/templates starters:build`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bundledStartersModule, starterFiles } from './starter-files';

const OUT = fileURLToPath(new URL('../starters/', import.meta.url));
const MODULE = fileURLToPath(new URL('../src/starters/bundled-documents.ts', import.meta.url));

mkdirSync(OUT, { recursive: true });
const files = starterFiles();
for (const [file, text] of files) writeFileSync(`${OUT}${file}`, text);
writeFileSync(MODULE, bundledStartersModule([...files.keys()]));
process.stdout.write(`wrote ${files.size - 1} starters\n`);
