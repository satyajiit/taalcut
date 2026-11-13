// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadGoldenDir } from './evaluate';
import { cliArgs, isDirectRun } from './entry';
import { stubPrediction } from './stub';

const USAGE = 'Usage: taalcut-evals stub --golden <dir> --out <dir>';

export function main(argv: string[]): number {
  try {
    const { values } = parseArgs({
      args: cliArgs(argv),
      options: { golden: { type: 'string' }, out: { type: 'string' } },
      strict: true,
    });
    if (values.golden === undefined || values.out === undefined) {
      throw new Error(`${USAGE}\n--golden and --out are required`);
    }
    const outDir = resolve(values.out);
    const reels = loadGoldenDir(resolve(values.golden));
    mkdirSync(outDir, { recursive: true });
    for (const reel of reels) {
      const prediction = stubPrediction(reel);
      writeFileSync(join(outDir, `${prediction.reelId}.json`), `${JSON.stringify(prediction, null, 2)}\n`);
    }
    console.log(`Wrote ${reels.length} stub prediction(s) to ${outDir}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) process.exit(main(process.argv.slice(2)));
