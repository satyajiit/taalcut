// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { castingJsonSchema } from './casting/schema';
import { cliArgs, isDirectRun } from './entry';
import { goldenJsonSchema } from './schema';
import { searchJsonSchema } from './search/schema';
import { usabilityJsonSchema } from './usability/schema';

const USAGE = 'Usage: taalcut-evals schema --out <file.schema.json> [--kind golden|search|casting|usability]';

function schemaFor(kind: string): unknown {
  if (kind === 'golden') return goldenJsonSchema();
  if (kind === 'search') return searchJsonSchema();
  if (kind === 'casting') return castingJsonSchema();
  if (kind === 'usability') return usabilityJsonSchema();
  throw new Error(`${USAGE}\n--kind must be golden, search, casting, or usability`);
}

export function main(argv: string[]): number {
  try {
    const { values } = parseArgs({
      args: cliArgs(argv),
      options: { out: { type: 'string' }, kind: { type: 'string' } },
      strict: true,
    });
    if (values.out === undefined) throw new Error(`${USAGE}\n--out is required`);
    const outPath = resolve(values.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(schemaFor(values.kind ?? 'golden'), null, 2)}\n`);
    console.log(`Wrote ${outPath}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) process.exit(main(process.argv.slice(2)));
