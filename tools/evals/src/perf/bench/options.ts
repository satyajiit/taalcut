// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing bench's command line (IX-B1). `run` (the default) builds the test app once and indexes the
 * footage `--runs` times at the forced `--tier`, with the mac helper (on-screen text) unless `--no-mac-helper`;
 * `analyse` reads runs again (after the analysis changed); `compare` diffs two summaries; `budgets` checks one
 * against the indexing budgets and, with `--write`, tightens them to its medians (`--reset`: replaces them, for
 * when the work measured changed).
 */
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { DEFAULT_MIN_FREE_GB } from './disk-floor';
import { benchTierSchema, type BenchTier } from './run-record';

export const FOOTAGE_SETS = ['smoke', 'ix-v1'] as const;
export type FootageSet = (typeof FOOTAGE_SETS)[number];

export const USAGE = [
  'Usage: pnpm bench:index [run] [--tier minimum|recommended|high] [--runs N] [--footage smoke|ix-v1]',
  '         [--label NAME] [--no-build] [--no-mac-helper] [--bench-root DIR] [--copy-to DIR] [--stall-dir DIR]',
  '         [--min-free-gb N] [--keep-compiles]',
  '       pnpm bench:index analyse <label> [--bench-root DIR] [--copy-to DIR]',
  '       pnpm bench:index compare <label|summary.json> <label|summary.json> [--bench-root DIR] [--out FILE]',
  '       pnpm bench:index budgets <label|summary.json> [--write | --reset] [--bench-root DIR]',
  'Defaults: --tier recommended --runs 3 --footage ix-v1, the bench root $TAALCUT_BENCH_ROOT or ~/TaalcutBench,',
  'a label <tier>-<footage>-<yyyymmdd-hhmm>. Run it under the machine video-encoder lock.',
  `It refuses to start with less than --min-free-gb (default ${DEFAULT_MIN_FREE_GB}) GB free, and removes the Core ML`,
  'compiles each run created unless --keep-compiles.',
  'On macOS a run needs the mac helper ($TAALCUT_MAC_HELPER or native/mac-helper/dist): it fails without one;',
  '--no-mac-helper benches without on-screen text (OCR), and the summary says so.',
].join('\n');

export interface RunOptions {
  readonly command: 'run';
  readonly tier: BenchTier;
  readonly runs: number;
  readonly footage: FootageSet;
  readonly label: string;
  readonly build: boolean;
  /** Bench with the mac helper (on-screen text); false only with `--no-mac-helper`. */
  readonly macHelper: boolean;
  readonly benchRoot: string;
  /** Where the summary is copied as `<copyTo>/<label>/` (the orchestration folder), if anywhere. */
  readonly copyTo: string | null;
  /**
   * Where a stalled FFmpeg call is reported (`vt-stall-<time>.md`; the process is never killed): `--stall-dir`,
   * else $TAALCUT_VT_STALL_DIR, else the label's folder. A stall stops the bench.
   */
  readonly stallDir: string;
  /** Free GB the bench root's and the compile cache's volumes need before a run (disk-floor.ts). */
  readonly minFreeGb: number;
  /** Keep the Core ML compiles each run created (compile-cleanup.ts); false unless `--keep-compiles`. */
  readonly keepCompiles: boolean;
}

export interface AnalyseOptions {
  readonly command: 'analyse';
  readonly label: string;
  readonly benchRoot: string;
  readonly copyTo: string | null;
}

export interface CompareOptions {
  readonly command: 'compare';
  /** Each a label under the bench root or a path to a summary.json. */
  readonly before: string;
  readonly after: string;
  readonly benchRoot: string;
  readonly out: string | null;
}

export interface BudgetsOptions {
  readonly command: 'budgets';
  /** A label under the bench root or a path to a summary.json. */
  readonly summary: string;
  /** Lower the budgets to the summary's medians where those are lower. */
  readonly write: boolean;
  /** Replace the budgets with the summary's medians, higher or lower (the work measured changed). */
  readonly reset: boolean;
  readonly benchRoot: string;
}

export type BenchOptions = RunOptions | AnalyseOptions | CompareOptions | BudgetsOptions;

const labelSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/, 'a label is letters, digits, dot, dash or underscore');

const runsSchema = z.coerce.number().int().min(1).max(20);
const freeGbSchema = z.coerce.number().min(0).max(100_000);
const footageSchema = z.enum(FOOTAGE_SETS);

function parseOr<T>(schema: z.ZodType<T>, value: unknown, flag: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${flag}: ${parsed.error.issues[0]?.message ?? 'invalid'}\n${USAGE}`);
  return parsed.data;
}

const stamp = (now: Date) =>
  now
    .toISOString()
    .slice(0, 16)
    .replace('T', '-')
    .replaceAll(':', '')
    .replaceAll('-', '')
    .replace(/^(\d{8})/, '$1-');

function absolute(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

export interface OptionContext {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly now: Date;
}

function readArgs(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        tier: { type: 'string' },
        runs: { type: 'string' },
        footage: { type: 'string' },
        label: { type: 'string' },
        'no-build': { type: 'boolean' },
        'no-mac-helper': { type: 'boolean' },
        'bench-root': { type: 'string' },
        'copy-to': { type: 'string' },
        out: { type: 'string' },
        write: { type: 'boolean' },
        reset: { type: 'boolean' },
        'stall-dir': { type: 'string' },
        'min-free-gb': { type: 'string' },
        'keep-compiles': { type: 'boolean' },
      },
    });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`, { cause: error });
  }
}

type ParsedArgs = ReturnType<typeof readArgs>['values'];

interface Common {
  readonly benchRoot: string;
  readonly copyTo: string | null;
}

function compareOptions(
  rest: readonly string[],
  values: ParsedArgs,
  common: Common,
  cwd: string,
): CompareOptions {
  const [before, after] = rest;
  if (before === undefined || after === undefined || rest.length !== 2)
    throw new Error(`compare takes two summaries\n${USAGE}`);
  const out = values.out === undefined ? null : absolute(values.out, cwd);
  return { command: 'compare', before, after, benchRoot: common.benchRoot, out };
}

function budgetsOptions(rest: readonly string[], values: ParsedArgs, common: Common): BudgetsOptions {
  const [summary] = rest;
  if (summary === undefined || rest.length !== 1) throw new Error(`budgets takes one summary\n${USAGE}`);
  if (values.write === true && values.reset === true)
    throw new Error(`budgets takes --write or --reset, not both\n${USAGE}`);
  return {
    command: 'budgets',
    summary,
    write: values.write === true,
    reset: values.reset === true,
    benchRoot: common.benchRoot,
  };
}

function analyseOptions(rest: readonly string[], common: Common): AnalyseOptions {
  if (rest.length !== 1) throw new Error(`analyse takes one label\n${USAGE}`);
  return { command: 'analyse', label: parseOr(labelSchema, rest[0], 'label'), ...common };
}

function runOptions(values: ParsedArgs, common: Common, context: OptionContext): RunOptions {
  const tier = parseOr(benchTierSchema, values.tier ?? 'recommended', '--tier');
  const footage = parseOr(footageSchema, values.footage ?? 'ix-v1', '--footage');
  const label = parseOr(labelSchema, values.label ?? `${tier}-${footage}-${stamp(context.now)}`, '--label');
  const stallDir = values['stall-dir'] ?? context.env.TAALCUT_VT_STALL_DIR?.trim();
  return {
    command: 'run',
    tier,
    runs: parseOr(runsSchema, values.runs ?? '3', '--runs'),
    footage,
    label,
    build: values['no-build'] !== true,
    macHelper: values['no-mac-helper'] !== true,
    ...common,
    stallDir: stallDir ? absolute(stallDir, context.cwd) : join(common.benchRoot, 'runs', label),
    minFreeGb: parseOr(freeGbSchema, values['min-free-gb'] ?? String(DEFAULT_MIN_FREE_GB), '--min-free-gb'),
    keepCompiles: values['keep-compiles'] === true,
  };
}

export function parseBenchArgs(argv: readonly string[], context: OptionContext): BenchOptions {
  const { values, positionals } = readArgs(argv);
  const [command = 'run', ...rest] = positionals;
  const common: Common = {
    benchRoot: absolute(
      values['bench-root'] ?? (context.env.TAALCUT_BENCH_ROOT?.trim() || join(homedir(), 'TaalcutBench')),
      context.cwd,
    ),
    copyTo: values['copy-to'] === undefined ? null : absolute(values['copy-to'], context.cwd),
  };
  if (command === 'compare') return compareOptions(rest, values, common, context.cwd);
  if (command === 'budgets') return budgetsOptions(rest, values, common);
  if (command === 'analyse') return analyseOptions(rest, common);
  if (command !== 'run' || rest.length > 0)
    throw new Error(`unknown command '${positionals.join(' ')}'\n${USAGE}`);
  return runOptions(values, common, context);
}
