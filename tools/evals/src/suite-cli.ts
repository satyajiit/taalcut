// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `fixtures:<suite>`, `predict:<suite>` and `eval:<suite>` commands every P3-Q2 suite shares. A suite supplies
 * its own loaders, adapter, scorer and writers; this module only parses flags and prints. `eval` exits 1 below the
 * suite's bar, so the PR job that runs it goes red.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from './entry';

export interface SuiteReport {
  readonly claimed: boolean;
  readonly gate: { readonly pass: boolean; readonly detail: string };
}

export interface SuiteCommands<Report extends SuiteReport, Prediction> {
  readonly suite: string;
  /** Extra usage lines, after the three commands. */
  readonly notes?: string;
  score(labelsDir: string, predictionsDir: string): Report;
  writeReport(report: Report, markdownPath: string): void;
  predict(labelsDir: string): readonly Prediction[] | Promise<readonly Prediction[]>;
  writePredictions(predictions: readonly Prediction[], outDir: string): void;
  writeFixtures(outDir: string): { labels: string };
}

function usage(suite: string, notes: string | undefined): string {
  const lines = [
    'Usage:',
    `  eval:${suite} --labels <dir> --predictions <dir> --out <report.md>`,
    `  predict:${suite} --labels <dir> --out <dir>`,
    `  fixtures:${suite} --out <dir>`,
  ];
  return notes === undefined ? lines.join('\n') : `${lines.join('\n')}\n${notes}`;
}

/** Parses `--name <value>` flags and returns each as an absolute path, or throws the usage when one is missing. */
function paths(argv: string[], names: readonly string[], help: string): (name: string) => string {
  const { values } = parseArgs({
    args: argv,
    options: Object.fromEntries(names.map((name) => [name, { type: 'string' as const }])),
    strict: true,
  });
  const missing = names.filter((name) => typeof values[name] !== 'string');
  if (missing.length > 0) throw new Error(`${help}\n${names.map((name) => `--${name}`).join(', ')} required`);
  return (name) => {
    const value = values[name];
    if (typeof value !== 'string') throw new Error(`${help}\n--${name} required`);
    return resolve(value);
  };
}

export async function runSuiteCli<Report extends SuiteReport, Prediction>(
  commands: SuiteCommands<Report, Prediction>,
  argv: string[],
): Promise<number> {
  const help = usage(commands.suite, commands.notes);
  try {
    const args = cliArgs(argv);
    const rest = cliArgs(args.slice(1));
    if (args[0] === 'eval') {
      const flag = paths(rest, ['labels', 'predictions', 'out'], help);
      const report = commands.score(flag('labels'), flag('predictions'));
      commands.writeReport(report, flag('out'));
      const claim = report.claimed ? '' : ' Synthetic: not a gate result.';
      console.log(`${report.gate.detail}. ${report.gate.pass ? 'pass' : 'fail'}.${claim}`);
      return report.gate.pass ? 0 : 1;
    }
    if (args[0] === 'predict') {
      const flag = paths(rest, ['labels', 'out'], help);
      const predictions = await commands.predict(flag('labels'));
      commands.writePredictions(predictions, flag('out'));
      console.log(`Wrote ${predictions.length} ${commands.suite} predictions to ${flag('out')}`);
      return 0;
    }
    if (args[0] === 'fixtures') {
      const flag = paths(rest, ['out'], help);
      console.log(`Wrote synthetic ${commands.suite} labels ${commands.writeFixtures(flag('out')).labels}`);
      return 0;
    }
    throw new Error(help);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** Runs the commands when `moduleUrl` is the process entry. */
export function suiteEntry<Report extends SuiteReport, Prediction>(
  moduleUrl: string,
  commands: SuiteCommands<Report, Prediction>,
): void {
  if (!isDirectRun(moduleUrl)) return;
  void runSuiteCli(commands, process.argv.slice(2)).then((code) => process.exit(code));
}
