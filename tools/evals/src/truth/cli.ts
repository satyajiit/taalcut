// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `pnpm eval:truth -- --truth <truth.json> --template <template.json> [--out <score.json>]`: a breakdown's template
 * scored against a reel's truth file (score.ts). Prints the score as JSON.
 */
import { parseArgs } from 'node:util';
import { templateSchema } from '@taalcut/core';
import { cliArgs, isDirectRun } from '../entry';
import { readJson, writeJson } from '../files';
import { truthSchema } from './schema';
import { scoreTemplate, type TruthScore } from './score';

const USAGE =
  'Usage: taalcut-evals truth --truth <truth.json> --template <template.json> [--out <score.json>]';

export function runTruth(argv: string[]): TruthScore {
  const { values } = parseArgs({
    args: cliArgs(argv),
    options: { truth: { type: 'string' }, template: { type: 'string' }, out: { type: 'string' } },
  });
  if (!values.truth || !values.template) throw new Error(USAGE);
  const truth = truthSchema.parse(readJson(values.truth));
  const template = templateSchema.parse(readJson(values.template));
  const score = scoreTemplate(template, truth);
  if (values.out) writeJson(values.out, score);
  return score;
}

if (isDirectRun(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(runTruth(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
