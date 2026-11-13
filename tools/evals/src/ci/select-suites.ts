// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Prints the feature-eval suite ids whose path globs match a change list.
 * `tools/evals/**`, `packages/core/**` and the workflow itself select every suite: the suites read core's schemas
 * and are cheap (no media). A `prefix/**` glob matches `prefix` and `prefix/...`; a `prefix*` glob matches the
 * files and folders in prefix's folder whose names start that way.
 *
 * `--listening` prints the EAR1 listening suites instead (`listening` in ci-paths.json, EAR1-I3). They need FFmpeg
 * or the local listen models and take minutes, so the PR job's synthetic loop doesn't run them; each one runs with
 * `eval -- --suite <id>` and skips cleanly where its models aren't installed.
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { cliArgs, isDirectRun } from '../entry';
import paths from '../../ci-paths.json' with { type: 'json' };

export const SUITE_IDS = ['reframe', 'variants', 'voice', 'router', 'interchange', 'cleanup'] as const;
export type SuiteId = (typeof SUITE_IDS)[number];

/** EAR1-I3: the listening suites, in the order `eval` runs them. */
export const LISTEN_SUITE_IDS = [
  'listen-pick',
  'listen-parity',
  'listen-breakdown-hits',
  'listen-mood',
] as const;
export type ListenSuiteId = (typeof LISTEN_SUITE_IDS)[number];

const suiteList = z.array(z.string().min(1)).min(1);
/** A suite's bars: metric name → bar; the suite says whether higher or lower passes. */
const bars = z.record(z.string().min(1), z.number());
const ciPathsSchema = z
  .object({
    suites: z
      .object({
        reframe: suiteList,
        variants: suiteList,
        voice: suiteList,
        router: suiteList,
        interchange: suiteList,
        cleanup: suiteList,
      })
      .strict(),
    listening: z
      .object({
        'listen-pick': suiteList,
        'listen-parity': suiteList,
        'listen-breakdown-hits': suiteList,
        'listen-mood': suiteList,
      })
      .strict(),
    features: z
      .object({
        'P3-V2': z.literal('reframe'),
        'P3-V3': z.literal('variants'),
        'P3-B6': z.literal('voice'),
        'P3-B11': z.literal('router'),
        'P3-V5': z.literal('interchange'),
        'P3-V9': z.literal('cleanup'),
        'EAR1-B2': z.literal('listen-pick'),
        'EAR1-F5': z.literal('listen-parity'),
        'EAR1-F6': z.literal('listen-parity'),
        'EAR1-A1': z.literal('listen-parity'),
        'EAR1-C1': z.literal('listen-breakdown-hits'),
        'EAR1-B3': z.literal('listen-mood'),
      })
      .strict(),
    /** EAR1: the listening suites' bars (they run outside the PR job's synthetic loop). */
    thresholds: z
      .object({
        'listen-pick': bars,
        'listen-parity': bars,
        'listen-breakdown-hits': bars,
        'listen-mood': bars,
      })
      .strict(),
  })
  .strict();

export const CI_PATHS = ciPathsSchema.parse(paths);

const SHA = /^[0-9a-f]{4,64}$/i;

/** Changes here can move every suite's result. */
export const EVERY_SUITE = [
  'tools/evals/**',
  'packages/core/**',
  '.github/workflows/feature-evals.yml',
] as const;

const USAGE = `Usage:
  select-suites [--listening] <path>...
  select-suites [--listening] --base <sha> --head <sha>`;

/** The suites whose bars are in ci-paths.json, with the features that point at each. */
export function featuresOf(suite: SuiteId | ListenSuiteId): string[] {
  return Object.entries(CI_PATHS.features).flatMap(([feature, id]) => (id === suite ? [feature] : []));
}

/**
 * `prefix/**` matches that directory and everything under it; `prefix*` (a `*` ending the last name) the entries of
 * prefix's directory whose names start with it, and everything under them; any other glob is a path or directory.
 */
export function globMatches(glob: string, path: string): boolean {
  if (glob.endsWith('*') && !glob.endsWith('/**')) return path.startsWith(glob.slice(0, -1));
  const prefix = glob.endsWith('/**') ? glob.slice(0, -3) : glob;
  return path === prefix || path.startsWith(`${prefix}/`);
}

function select<Id extends string>(
  changed: readonly string[],
  ids: readonly Id[],
  globs: Readonly<Record<Id, readonly string[]>>,
): Id[] {
  const pathsChanged = changed.map((path) => path.replace(/^\.\//, ''));
  if (pathsChanged.some((path) => EVERY_SUITE.some((glob) => globMatches(glob, path)))) return [...ids];
  return ids.filter((id) => globs[id].some((glob) => pathsChanged.some((path) => globMatches(glob, path))));
}

export function selectSuites(changed: readonly string[]): SuiteId[] {
  return select(changed, SUITE_IDS, CI_PATHS.suites);
}

/** EAR1-I3: the listening suites a change list selects. */
export function selectListenSuites(changed: readonly string[]): ListenSuiteId[] {
  return select(changed, LISTEN_SUITE_IDS, CI_PATHS.listening);
}

export function changedBetween(base: string, head: string): string[] {
  if (!SHA.test(base) || !SHA.test(head)) throw new Error('base and head must be hex commit ids');
  const text = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' });
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function main(argv: string[]): number {
  try {
    const args = cliArgs(argv);
    const { values, positionals } = parseArgs({
      args,
      options: { base: { type: 'string' }, head: { type: 'string' }, listening: { type: 'boolean' } },
      strict: true,
      allowPositionals: true,
    });
    if ((values.base === undefined) !== (values.head === undefined)) throw new Error(USAGE);
    if (values.base !== undefined && positionals.length > 0) throw new Error(USAGE);
    if (values.base === undefined && positionals.length === 0) throw new Error(USAGE);
    const changed =
      values.base !== undefined && values.head !== undefined
        ? changedBetween(values.base, values.head)
        : positionals;
    for (const id of values.listening ? selectListenSuites(changed) : selectSuites(changed)) console.log(id);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
