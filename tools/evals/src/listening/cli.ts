// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `eval` without `--golden`, or `eval:listen` (EAR1-I3): the listening suites, every one or those named with
 * `--suite`, each report under `--out <dir>` (default: a new temporary folder). Exits 1 when any suite is below a bar
 * or stops on an error; a suite skipped for want of models, FFmpeg or a labelled set doesn't fail the run.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { LISTEN_SUITE_IDS } from '../ci/select-suites';
import { cliArgs, isDirectRun } from '../entry';
import { isListenSuite, runListening } from './run';

export const LISTEN_USAGE = `Usage: eval [--suite <${LISTEN_SUITE_IDS.join('|')}>]... [--out <dir>]
  Models: TAALCUT_EAR1_MODELS (unpacked listen builds), TAALCUT_LISTEN_DTYPE=fp16|int8, TAALCUT_SFX_BANK.
  listen-mood: TAALCUT_LISTEN_MOOD_MANIFEST (a CC0 mood-labelled set).`;

export async function runListenCli(argv: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args: cliArgs(argv),
      options: { suite: { type: 'string', multiple: true }, out: { type: 'string' } },
      strict: true,
    });
    const named = values.suite ?? [...LISTEN_SUITE_IDS];
    const unknown = named.filter((id) => !isListenSuite(id));
    if (unknown.length > 0)
      throw new Error(`Unknown listening suite: ${unknown.join(', ')}\n${LISTEN_USAGE}`);
    const ids = LISTEN_SUITE_IDS.filter((id) => named.includes(id));
    const outDir = values.out ? resolve(values.out) : mkdtempSync(join(tmpdir(), 'taalcut-listen-evals-'));
    const outcomes = await runListening(ids, outDir);
    console.log(`Listening reports in ${outDir}`);
    return outcomes.some((o) => o.status === 'fail') ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) void runListenCli(process.argv.slice(2)).then((code) => process.exit(code));
