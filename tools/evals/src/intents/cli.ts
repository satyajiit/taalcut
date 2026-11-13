// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from '../entry';
import { writeText } from '../files';
import { abCommand } from './ab-cli';
import { scoreIntentFile } from './score';
import { intentRows, sheetCsv } from './sheet';

const SHEET_USAGE = 'Usage: taalcut-evals intents --golden <dir> --predictions <dir> --out <sheet.csv>';
const SCORE_USAGE = 'Usage: taalcut-evals intents:score --sheet <rated.csv>';

export function sheetMain(argv: string[]): number {
  try {
    const { values } = parseArgs({
      args: cliArgs(argv),
      options: {
        golden: { type: 'string' },
        predictions: { type: 'string' },
        out: { type: 'string' },
      },
      strict: true,
    });
    if (values.golden === undefined || values.predictions === undefined || values.out === undefined) {
      throw new Error(`${SHEET_USAGE}\n--golden, --predictions and --out are required`);
    }
    const rows = intentRows(resolve(values.golden), resolve(values.predictions));
    writeText(resolve(values.out), sheetCsv(rows));
    console.log(`Wrote ${rows.length} slots to ${resolve(values.out)}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function scoreMain(argv: string[]): number {
  try {
    const { values } = parseArgs({
      args: cliArgs(argv),
      options: { sheet: { type: 'string' } },
      strict: true,
    });
    if (values.sheet === undefined) throw new Error(`${SCORE_USAGE}\n--sheet is required`);
    const score = scoreIntentFile(resolve(values.sheet));
    const claim = score.envelope.claimed ? '' : ' Synthetic: not a gate result.';
    console.log(
      `Usable ${score.usable}/${score.rows} (${score.share.toFixed(3)}). ${score.pass ? 'pass' : 'fail'}.${claim}`,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** `intents` (the P2-T5 sheet), `intents score`, and the LRN1-CTX A/B commands (`./ab-cli.ts`). */
export async function main(argv: string[]): Promise<number> {
  const args = cliArgs(argv);
  const command = args[0];
  if (command === 'score') return scoreMain(args.slice(1));
  const ab = abCommand(command);
  if (ab) return ab(cliArgs(args.slice(1)));
  return sheetMain(argv);
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
