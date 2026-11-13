// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The frozen tone set and its lock (SPEC section 22). The 20 prompts are re-run on every SOUL.md version bump
 * and never edited in the same change as SOUL.md: otherwise a persona change could be "passed" by moving the
 * questions. `tone-lock.json` is a chain of (SOUL.md version, SOUL.md hash, prompt-set hash) entries; the
 * current files must match its last entry, each step may change SOUL.md or the prompt set but not both, and a
 * SOUL.md change must bump its version. The recording (`tone-recording.json`) answers one entry: a recording
 * for another version or prompt set is stale and its report is "unmeasured".
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attempt, err, ok, type Result } from '@taalcut/core';
import { z } from 'zod';
import { ToneRecordingInvalid } from '../errors';
import {
  toneRecordingSchema,
  tonePromptSetSchema,
  TONE_TRAPS,
  type TonePromptSet,
  type ToneRecording,
} from '../evals/tone-types';

export const TONE_PROMPTS_PATH = join(import.meta.dirname, 'tone-prompts.json');
export const TONE_LOCK_PATH = join(import.meta.dirname, 'tone-lock.json');
/** The committed recording: stand-in until the PO records with real keys. */
export const TONE_RECORDING_PATH = join(import.meta.dirname, 'tone-recording.json');

/** sha256 of a text file's content, line endings normalised. */
export function textSha256(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex');
}

const DEFAULT_DIALS = { tone: 2, verbosity: 1 } as const;
const CORNERS = [
  { tone: 0, verbosity: 0 },
  { tone: 0, verbosity: 4 },
  { tone: 4, verbosity: 0 },
  { tone: 4, verbosity: 4 },
] as const;

/** What breaks the set's composition: 4 prompts per dial corner, 4 traps at the default dials, 2 hi, 2 es. */
export function promptSetProblems(set: TonePromptSet): string[] {
  const problems: string[] = [];
  const ids = set.prompts.map((p) => p.id);
  if (new Set(ids).size !== ids.length) problems.push('Prompt ids repeat.');
  for (const corner of CORNERS) {
    const n = set.prompts.filter(
      (p) => !p.trap && p.dials.tone === corner.tone && p.dials.verbosity === corner.verbosity,
    ).length;
    if (n !== 4)
      problems.push(`${n} prompts at tone ${corner.tone}, verbosity ${corner.verbosity}; 4 expected.`);
  }
  const traps = set.prompts.filter((p) => p.trap);
  if (
    traps
      .map((p) => p.trap)
      .sort()
      .join(',') !== [...TONE_TRAPS].sort().join(',')
  )
    problems.push('The four traps (sycophancy, slop, ignoreDials, factual) each once.');
  if (traps.some((p) => p.dials.tone !== DEFAULT_DIALS.tone || p.dials.verbosity !== DEFAULT_DIALS.verbosity))
    problems.push('Traps are asked at the default dials.');
  for (const language of ['hi', 'es'] as const) {
    const n = set.prompts.filter((p) => p.language === language).length;
    if (n !== 2) problems.push(`${n} prompts in ${language}; 2 expected.`);
  }
  return problems;
}

/** The frozen set from its file: the schema, then the composition. */
/** A tone file's JSON through its schema; a bad file names its rule. */
function parseToneJson<S extends z.ZodType>(
  text: string,
  schema: S,
  rule: 'promptSet' | 'recording',
): Result<z.output<S>> {
  const json = attempt(() => JSON.parse(text) as unknown);
  if (!json.ok) return json;
  const parsed = schema.safeParse(json.value);
  return parsed.success
    ? ok(parsed.data)
    : err(ToneRecordingInvalid({ rule }, { detail: z.prettifyError(parsed.error) }));
}

export function readTonePromptSet(text: string): Result<TonePromptSet> {
  const parsed = parseToneJson(text, tonePromptSetSchema, 'promptSet');
  if (!parsed.ok) return parsed;
  const problems = promptSetProblems(parsed.value);
  return problems.length > 0
    ? err(ToneRecordingInvalid({ rule: 'promptSet' }, { detail: problems.join(' ') }))
    : parsed;
}

export function loadTonePromptSet(path = TONE_PROMPTS_PATH): Result<{ set: TonePromptSet; sha256: string }> {
  const text = attempt(() => readFileSync(path, 'utf8'));
  if (!text.ok) return text;
  const set = readTonePromptSet(text.value);
  return set.ok ? ok({ set: set.value, sha256: textSha256(text.value) }) : set;
}

export function loadToneRecording(path = TONE_RECORDING_PATH): Result<ToneRecording> {
  const text = attempt(() => readFileSync(path, 'utf8'));
  return text.ok ? parseToneJson(text.value, toneRecordingSchema, 'recording') : text;
}

const lockEntrySchema = z.object({
  soulVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  soulSha256: z.string().regex(/^[0-9a-f]{64}$/),
  promptSetSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const toneLockSchema = z.object({ entries: z.array(lockEntrySchema).min(1) });
export type ToneLock = z.output<typeof toneLockSchema>;
export type ToneLockEntry = z.output<typeof lockEntrySchema>;

const versionParts = (version: string) => version.split('.').map(Number);
function versionAbove(next: string, previous: string): boolean {
  const [a, b] = [versionParts(next), versionParts(previous)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/** What breaks the lock: the chain's rules, and the current files against its last entry. */
export function toneLockProblems(lock: ToneLock, current: ToneLockEntry): string[] {
  const problems: string[] = [];
  lock.entries.slice(1).forEach((entry, i) => {
    const before = lock.entries[i];
    if (!before) return;
    const soulChanged = entry.soulSha256 !== before.soulSha256;
    const setChanged = entry.promptSetSha256 !== before.promptSetSha256;
    if (soulChanged && setChanged)
      problems.push(`Entry ${i + 2} changes SOUL.md and the prompt set together: change them separately.`);
    if (soulChanged && !versionAbove(entry.soulVersion, before.soulVersion))
      problems.push(`Entry ${i + 2} changes SOUL.md without bumping its version (${before.soulVersion}).`);
  });
  const last = lock.entries.at(-1);
  if (
    !last ||
    last.soulSha256 !== current.soulSha256 ||
    last.promptSetSha256 !== current.promptSetSha256 ||
    last.soulVersion !== current.soulVersion
  )
    problems.push(
      'SOUL.md or the prompt set changed: append an entry to tone-lock.json (one of the two per entry) and re-record the tone session.',
    );
  return problems;
}
