// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { reelsFromCsv } from './csv';
import { cliArgs, isDirectRun } from './entry';
import { searchCsvCommand } from './search/cli';

const USAGE = `Usage:
  taalcut-evals csv --in <sheet.csv> --out <dir>
  taalcut-evals csv --kind search --in <sheet.csv> --out <dir>
  taalcut-evals csv --kind golden --in <sheet.csv> --out <dir>`;

function writeGolden(csvPath: string, outDir: string): number {
  const reels = reelsFromCsv(readFileSync(csvPath, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  for (const reel of reels) {
    writeFileSync(join(outDir, `${reel.reelId}.json`), `${JSON.stringify(reel, null, 2)}\n`);
  }
  console.log(`Wrote ${reels.length} reel(s) to ${outDir}`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args: cliArgs(argv),
      options: { in: { type: 'string' }, out: { type: 'string' }, kind: { type: 'string' } },
      strict: true,
    });
    if (values.in === undefined || values.out === undefined) {
      throw new Error(`${USAGE}\n--in and --out are required`);
    }
    const csvPath = resolve(values.in);
    const outDir = resolve(values.out);
    const kind = values.kind ?? 'golden';
    if (kind === 'golden' || kind === 'breakdown') return writeGolden(csvPath, outDir);
    if (kind === 'search') return await searchCsvCommand(csvPath, outDir);
    throw new Error(`${USAGE}\n--kind must be golden or search`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
