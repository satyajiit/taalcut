// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compareFiles, renderCompare } from './compare';
import { cliArgs, isDirectRun } from './entry';

const USAGE = 'Usage: taalcut-evals compare --base <report.json> --head <report.json> [--out <report.md>]';

export function main(argv: string[]): number {
  try {
    const { values } = parseArgs({
      args: cliArgs(argv),
      options: {
        base: { type: 'string' },
        head: { type: 'string' },
        out: { type: 'string' },
      },
      strict: true,
    });
    if (values.base === undefined || values.head === undefined) {
      throw new Error(`${USAGE}\n--base and --head are required`);
    }
    const report = compareFiles(resolve(values.base), resolve(values.head));
    const markdown = renderCompare(report);
    if (values.out !== undefined) {
      const outPath = resolve(values.out);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, markdown);
      console.log(`Wrote ${outPath}`);
    } else {
      process.stdout.write(markdown);
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) process.exit(main(process.argv.slice(2)));
