// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from '../entry';
import { jsonFiles, readJson, writeJson, writeText } from '../files';
import { findingsMarkdown } from './findings';
import { parseUsabilitySession } from './schema';
import { summarise, summaryMarkdown, type UsabilitySummary } from './summary';

const USAGE = 'Usage: tsx src/usability/cli.ts summary --sessions <dir> --out <dir>';

/** Read every `*.json` session in `sessionsDir` and write summary.json, summary.md, and findings.md. */
export function summariseDir(sessionsDir: string, outDir: string): UsabilitySummary {
  const sessions = jsonFiles(sessionsDir).map((file) =>
    parseUsabilitySession(readJson(file.path), file.name),
  );
  const summary = summarise(sessions);
  writeJson(resolve(outDir, 'summary.json'), summary);
  writeText(resolve(outDir, 'summary.md'), summaryMarkdown(summary));
  writeText(resolve(outDir, 'findings.md'), findingsMarkdown(sessions));
  return summary;
}

export function main(argv: string[]): number {
  try {
    const { values, positionals } = parseArgs({
      args: cliArgs(argv),
      options: {
        sessions: { type: 'string' },
        out: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length !== 1 || positionals[0] !== 'summary') {
      throw new Error(`${USAGE}\nexpected the summary command`);
    }
    if (values.sessions === undefined || values.out === undefined) {
      throw new Error(`${USAGE}\n--sessions and --out are required`);
    }
    const summary = summariseDir(resolve(values.sessions), resolve(values.out));
    console.log(`Wrote ${summary.sessionCount} sessions to ${resolve(values.out)}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) process.exit(main(process.argv.slice(2)));
