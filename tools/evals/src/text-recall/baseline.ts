// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The on-screen text recall gate (IX3-B1, design C): a library passes when it reads at least the baseline's floor of
 * words and loses no word the baseline read. The baseline is what the shipped pipeline read, taken from several
 * libraries that must all read the same words (IX3-B3: three runs), so one run's luck never becomes the bar; its floor
 * is the number of words they read (IX3 decision b). Without a baseline the floor is 19 of 24, the PO's accepted
 * number at the IX2 gate. A word read now that the baseline did not read is reported, never required.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readJson, writeJson } from '../files';
import { parseNamed } from '../schema';
import { foundKeys, type LibraryScore } from './score';

/** tools/evals/text-recall: the committed baselines, one per footage set. */
const BASELINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'text-recall');

export const defaultBaselinePath = (set: string): string => join(BASELINE_DIR, `baseline-${set}.json`);

/** The floor without a baseline (and the least a baseline may read): 19 of the 24 ix-v1 words, the IX2 gate's. */
export const DEFAULT_MIN_FOUND = 19;

export const baselineSchema = z.object({
  v: z.literal(1),
  /** The footage set the words belong to (the manifest's `set`). */
  set: z.string(),
  /** Where the words were read: bench labels or library paths, for people. */
  from: z.string(),
  takenAt: z.string(),
  /** The fewest words a library may read and pass: the words the baseline's libraries read. */
  minFound: z.int().nonnegative(),
  /** Words in the manifest when the baseline was taken. */
  total: z.int().positive(),
  /** `<file>:<word>` the baseline libraries all read. */
  found: z.array(z.string()),
});
export type TextBaseline = z.output<typeof baselineSchema>;

export function readBaseline(path: string): TextBaseline {
  if (!existsSync(path)) throw new Error(`no on-screen text recall baseline at ${path}`);
  return parseNamed(baselineSchema, readJson(path), path);
}

export const writeBaseline = (path: string, baseline: TextBaseline): void => writeJson(path, baseline);

export interface BaselineInput {
  readonly set: string;
  readonly from: string;
  readonly takenAt: string;
  /** The fewest words the libraries must read to become a baseline. */
  readonly minFound: number;
}

/**
 * The baseline the scores agree on, whose floor is the words they read (IX3 decision b: a later library must read as
 * many). Throws, naming the differences, when they read different words: a baseline that depends on the run is not
 * one; and when they read fewer than `input.minFound`.
 */
export function baselineFrom(scores: readonly LibraryScore[], input: BaselineInput): TextBaseline {
  const [first, ...rest] = scores;
  if (first === undefined) throw new Error('a baseline needs at least one library');
  const words = foundKeys(first);
  for (const score of rest) {
    const other = foundKeys(score);
    const only = (a: readonly string[], b: readonly string[]) => a.filter((key) => !b.includes(key));
    if (only(words, other).length > 0 || only(other, words).length > 0)
      throw new Error(
        `the libraries read different words, so no baseline is written: ${first.path} only ` +
          `[${only(words, other).join(' ')}], ${score.path} only [${only(other, words).join(' ')}]`,
      );
  }
  if (words.length < input.minFound)
    throw new Error(`the libraries read ${words.length} words, under the floor of ${input.minFound}`);
  return { v: 1, ...input, minFound: words.length, total: first.total, found: words };
}

export interface GateResult {
  readonly pass: boolean;
  readonly found: number;
  readonly total: number;
  readonly minFound: number;
  /** Baseline words this library did not read. */
  readonly lost: readonly string[];
  /** Words read that the baseline did not read. */
  readonly gained: readonly string[];
  /** False when no baseline was given: only the floor was checked. */
  readonly againstBaseline: boolean;
}

export function gateOf(score: LibraryScore, baseline: TextBaseline | null, minFound: number): GateResult {
  const found = foundKeys(score);
  const lost = baseline === null ? [] : baseline.found.filter((key) => !found.includes(key));
  const gained = baseline === null ? [] : found.filter((key) => !baseline.found.includes(key));
  return {
    pass: score.found >= minFound && lost.length === 0,
    found: score.found,
    total: score.total,
    minFound,
    lost,
    gained,
    againstBaseline: baseline !== null,
  };
}

/** The `gate:` line for one library. */
export function gateLine(path: string, gate: GateResult): string {
  const verdict = gate.pass ? 'pass' : 'FAIL';
  const floor = `${gate.found} of ${gate.total} read (floor ${gate.minFound})`;
  const baseline = gate.againstBaseline
    ? gate.lost.length === 0
      ? 'no baseline word lost'
      : `lost ${gate.lost.join(' ')}`
    : 'no baseline: floor only';
  const gained = gate.gained.length === 0 ? '' : `; read beyond the baseline ${gate.gained.join(' ')}`;
  return `gate: ${verdict} ${path}: ${floor}, ${baseline}${gained}`;
}
