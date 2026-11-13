// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { cliArgs, isDirectRun } from '../entry';
import { appendSoakResults } from './result';
import { runScenario, systemClock, unavailableApp } from './scenario';
import { SOAK_SCENARIOS } from './scenarios';
import { runSmoke, smokeApp } from './smoke';

const USAGE = [
  `Usage: tsx src/soak/cli.ts run --scenario ${[...SOAK_SCENARIOS.map((scenario) => scenario.id), 'all'].join('|')}`,
  '  --mode full|smoke --out <file.jsonl> [--real]',
  '  full, without a desktop app wired: verdict missing, detail "no app wired", no 8h timer.',
  '  --real sets synthetic false. Smoke is always the in-process fake and stays synthetic.',
].join('\n');

/** Scenario ids come from the registry, so a new scenario module needs no change here. */
const selectionSchema = z
  .object({
    scenario: z.string().min(1),
    mode: z.enum(['full', 'smoke']),
    out: z.string().min(1),
  })
  .strict();

export async function main(argv: string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: cliArgs(argv),
      options: {
        scenario: { type: 'string' },
        mode: { type: 'string' },
        out: { type: 'string' },
        real: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: true,
    });
    if (positionals[0] !== 'run') throw new Error(USAGE);
    const parsed = selectionSchema.safeParse({
      scenario: values.scenario,
      mode: values.mode,
      out: values.out,
    });
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => issue.message).join('; ');
      throw new Error(`${USAGE}\n${detail}`);
    }
    const { scenario: scenarioId, mode, out } = parsed.data;
    const selected = SOAK_SCENARIOS.filter((scenario) => scenarioId === 'all' || scenario.id === scenarioId);
    if (selected.length === 0) throw new Error(`${USAGE}\nunknown scenario ${scenarioId}`);
    const outPath = resolve(out);
    const results =
      mode === 'smoke'
        ? await runSmoke({ app: smokeApp(), scenarios: selected })
        : await Promise.all(
            selected.map((scenario) =>
              runScenario({
                scenario,
                app: unavailableApp(),
                clock: systemClock(),
                mode,
                synthetic: values.real !== true,
              }),
            ),
          );
    appendSoakResults(outPath, results);
    for (const result of results) {
      const marker = result.synthetic ? ' (synthetic: not a measurement)' : '';
      console.log(`${result.scenario} ${result.mode} ${result.verdict} ${result.detail}${marker}`);
    }
    console.log(`Wrote ${outPath} (${results.length} rows)`);
    return results.every((result) => result.verdict === 'pass') ? 0 : 1;
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
