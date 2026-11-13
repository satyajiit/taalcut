// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `eval:text-recall` (IX3-B1): on-screen text recall through the shipped pipeline. It reads what the app stored, in
 * library databases the app wrote (each bench run keeps one; the bench indexes the IX set the way the app does: the
 * test app, the decode switch's default, the app's shots, `vision.ocr` with the mac helper), scores the manifest's
 * known words (words.ts) and checks each library against the baseline (baseline.ts). A library the pipeline did not
 * finish is refused, and a refusal fails the run.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { cliArgs, isDirectRun } from '../entry';
import { readJson, writeJson, writeText } from '../files';
import { parseNamed } from '../schema';
import {
  baselineFrom,
  DEFAULT_MIN_FOUND,
  defaultBaselinePath,
  readBaseline,
  writeBaseline,
  type TextBaseline,
} from './baseline';
import { readStoredText } from './library';
import { libraryGateLine, textRecallMarkdown, textRecallReport, type TextRecallReport } from './report';
import { scoreLibrary } from './score';
import { knownLines, textManifestSchema } from './words';

const USAGE = `Usage:
  pnpm --filter @taalcut/evals run eval:text-recall -- --manifest <manifest.json>
       [--library <library.sqlite>]... [--bench <label|dir>]... [--bench-root <dir>]
       [--baseline <baseline.json> | --no-baseline] [--min-found <n>] [--out <report.md>]
       [--write-baseline <baseline.json>]

--manifest is the footage set's manifest.json (its clips' onScreen lines are the words).
--library reads one library database; --bench reads every run-<n>/index-library.sqlite of a bench label
(under --bench-root, default $TAALCUT_BENCH_ROOT or ~/TaalcutBench) or of a bench folder. To index the IX set
the way the app does, run the bench (pnpm bench:index --footage ix-v1, under the video-encoder lock) and read it.
The baseline defaults to tools/evals/text-recall/baseline-<set>.json; --no-baseline checks the floor only.
--write-baseline writes the baseline the libraries agree on (they must all read the same words) and exits.
Exit 0 when every library was scored and passed; 1 when one was refused, failed, or an input is wrong.`;

const minFoundSchema = z.coerce.number().int().nonnegative();

/**
 * The library copies of a bench: a label under `benchRoot`, or a bench folder. Every `run-<n>` must have kept one: a
 * run that didn't is named (no library at …), never left out of the count (IX3-F5, M7).
 */
export function benchLibraries(ref: string, benchRoot: string): string[] {
  const dir = existsSync(ref) ? resolve(ref) : join(benchRoot, 'runs', ref);
  if (!existsSync(dir)) throw new Error(`no bench at ${dir}`);
  const runs = readdirSync(dir)
    .map((name) => /^run-(\d+)$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((match) => join(dir, match[0], 'index-library.sqlite'));
  if (runs.length === 0) throw new Error(`${dir} has no run-<n>/index-library.sqlite`);
  return runs;
}

function readArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      manifest: { type: 'string' },
      library: { type: 'string', multiple: true },
      bench: { type: 'string', multiple: true },
      'bench-root': { type: 'string' },
      baseline: { type: 'string' },
      'no-baseline': { type: 'boolean' },
      'min-found': { type: 'string' },
      out: { type: 'string' },
      'write-baseline': { type: 'string' },
    },
    strict: true,
  }).values;
}
type Flags = ReturnType<typeof readArgs>;

function baselineOf(flags: Flags, set: string | null): { path: string; value: TextBaseline } | null {
  if (flags['no-baseline'] === true || flags['write-baseline'] !== undefined) return null;
  if (flags.baseline !== undefined)
    return { path: resolve(flags.baseline), value: readBaseline(resolve(flags.baseline)) };
  const path = set === null ? null : defaultBaselinePath(set);
  return path !== null && existsSync(path) ? { path, value: readBaseline(path) } : null;
}

export interface TextRecallRun {
  readonly report: TextRecallReport;
  readonly markdown: string;
  /** Set when `--write-baseline` wrote one. */
  readonly wrote: string | null;
}

export function evalTextRecall(
  argv: string[],
  env: Readonly<Record<string, string | undefined>>,
): TextRecallRun {
  const flags = readArgs(argv);
  if (flags.manifest === undefined) throw new Error(`${USAGE}\n--manifest is required`);
  if (flags.baseline !== undefined && flags['no-baseline'] === true)
    throw new Error(`${USAGE}\n--baseline and --no-baseline together`);
  const manifestPath = resolve(flags.manifest);
  const manifest = parseNamed(textManifestSchema, readJson(manifestPath), manifestPath);
  const lines = knownLines(manifest);
  if (lines.length === 0) throw new Error(`${manifestPath} lists no on-screen lines`);
  const benchRoot = resolve(
    flags['bench-root'] ?? (env.TAALCUT_BENCH_ROOT?.trim() || join(homedir(), 'TaalcutBench')),
  );
  const paths = [
    ...(flags.library ?? []).map((path) => resolve(path)),
    ...(flags.bench ?? []).flatMap((ref) => benchLibraries(ref, benchRoot)),
  ];
  if (paths.length === 0) throw new Error(`${USAGE}\nat least one --library or --bench is required`);
  for (const path of paths) if (!existsSync(path)) throw new Error(`no library at ${path}`);
  const set = manifest.set ?? null;
  const baseline = baselineOf(flags, set);
  const minFound = parseNamed(
    minFoundSchema,
    flags['min-found'] ?? baseline?.value.minFound ?? DEFAULT_MIN_FOUND,
    '--min-found',
  );
  const files = [...new Set(lines.map((line) => line.file))];
  const reads = paths.map((path) => readStoredText(path, files));
  const report = textRecallReport({ manifest: manifestPath, set, lines, reads, baseline, minFound });
  const markdown = textRecallMarkdown(report);
  const target = flags['write-baseline'];
  if (target === undefined || !report.pass) return { report, markdown, wrote: null };
  const scores = reads.flatMap((read) => (read.kind === 'read' ? [scoreLibrary(read.text, lines)] : []));
  const written = baselineFrom(scores, {
    set: set ?? 'unnamed',
    from: report.libraries.map((library) => library.name).join(', '),
    takenAt: new Date().toISOString(),
    minFound,
  });
  writeBaseline(resolve(target), written);
  return { report, markdown, wrote: resolve(target) };
}

export function main(argv: string[]): number {
  try {
    const args = cliArgs(argv);
    if (args.includes('--help') || args.includes('-h')) {
      console.log(USAGE);
      return 0;
    }
    const run = evalTextRecall(args, process.env);
    const out = readArgs(args).out;
    if (out === undefined) console.log(run.markdown);
    else {
      writeText(resolve(out), run.markdown);
      writeJson(resolve(out).replace(/\.md$/, '') + '.json', run.report);
      for (const library of run.report.libraries) console.log(libraryGateLine(library));
      console.log(`report: ${resolve(out)}`);
    }
    if (run.wrote !== null) console.log(`baseline written: ${run.wrote}`);
    return run.report.pass ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) process.exit(main(process.argv.slice(2)));
