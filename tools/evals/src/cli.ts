// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { evaluateDirs } from './evaluate';
import { cliArgs, isDirectRun } from './entry';
import { jsonPathFor, renderJson, renderMarkdown } from './report';

const USAGE = `Usage: taalcut-evals --golden <dir> --predictions <dir> --out <report.md>
       taalcut-evals [--suite <listening suite>]... [--out <dir>]   (the listening suites, EAR1-I3)`;

const named = (args: readonly string[], flag: string) =>
  args.some((arg) => arg === `--${flag}` || arg.startsWith(`--${flag}=`));

export async function main(argv: string[]): Promise<number> {
  const args = cliArgs(argv);
  // Without the golden set's flags: the listening suites (loaded only then, so the breakdown eval stays light).
  if (!named(args, 'golden') && !named(args, 'predictions'))
    return (await import('./listening/cli')).runListenCli(args);
  try {
    const { values } = parseArgs({
      args,
      options: {
        golden: { type: 'string' },
        predictions: { type: 'string' },
        out: { type: 'string' },
      },
      strict: true,
    });
    if (values.golden === undefined || values.predictions === undefined || values.out === undefined) {
      throw new Error(`${USAGE}\n--golden, --predictions, and --out are required`);
    }
    const outPath = resolve(values.out);
    const report = evaluateDirs(resolve(values.golden), resolve(values.predictions));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, renderMarkdown(report));
    writeFileSync(jsonPathFor(outPath), renderJson(report));
    const { f1, reelsMeetingBar, reelCount } = report.aggregate;
    console.log(`Wrote ${outPath} (F1 ${f1.toFixed(3)}, reels at bar ${reelsMeetingBar}/${reelCount})`);
    return 0;
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
