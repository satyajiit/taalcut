// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The frozen prompt set (SPEC section 22): 20 prompts in the agreed composition, never edited in the same
 * change as SOUL.md. The lock chain (tone-lock.json) must end at the current SOUL.md and prompt set, and no
 * step of it may change both, or change SOUL.md without bumping its version. In a git checkout, an
 * uncommitted change touching both files fails here too, before it is committed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import {
  loadTonePromptSet,
  promptSetProblems,
  readSoul,
  readTonePromptSet,
  textSha256,
  toneLockProblems,
  toneLockSchema,
  TONE_LOCK_PATH,
  TONE_PROMPTS_PATH,
  type ToneLockEntry,
  type TonePromptSet,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const SOUL_TEXT = readFileSync(join(ROOT, 'SOUL.md'), 'utf8');
const SOUL = unwrap(readSoul(SOUL_TEXT));
const PROMPTS_TEXT = readFileSync(TONE_PROMPTS_PATH, 'utf8');
const SET = unwrap(loadTonePromptSet()).set;
const LOCK = toneLockSchema.parse(JSON.parse(readFileSync(TONE_LOCK_PATH, 'utf8')));
const CURRENT: ToneLockEntry = {
  soulVersion: SOUL.version,
  soulSha256: textSha256(SOUL_TEXT),
  promptSetSha256: textSha256(PROMPTS_TEXT),
};

const entry = (soulVersion: string, soul: string, set: string): ToneLockEntry => ({
  soulVersion,
  soulSha256: soul.repeat(64),
  promptSetSha256: set.repeat(64),
});

describe('the frozen prompt set', () => {
  it('has 20 prompts: 4 per dial corner, 4 traps at the default dials, 2 in Hindi and 2 in Spanish', () => {
    expect(SET.prompts).toHaveLength(20);
    expect(promptSetProblems(SET)).toEqual([]);
    expect(SET.prompts.every((p) => p.toolResults.length > 0)).toBe(true);
  });

  it('names every way the composition can break', () => {
    const broken: TonePromptSet = {
      ...SET,
      prompts: SET.prompts.map((p, i) => {
        if (i === 0) return { ...p, id: 't02', dials: { tone: 2, verbosity: 2 } };
        if (p.trap === 'factual') return { ...p, trap: 'slop' as const, dials: { tone: 4, verbosity: 4 } };
        if (p.language === 'hi') return { ...p, language: 'pt-BR' as const };
        return p;
      }),
    };
    const problems = promptSetProblems(broken);
    expect(problems).toEqual(
      expect.arrayContaining([
        'Prompt ids repeat.',
        '3 prompts at tone 0, verbosity 0; 4 expected.',
        'The four traps (sycophancy, slop, ignoreDials, factual) each once.',
        'Traps are asked at the default dials.',
        '0 prompts in hi; 2 expected.',
      ]),
    );
  });

  it('refuses a file that is not the schema or not the composition', () => {
    expect(readTonePromptSet('not json').ok).toBe(false);
    const short = readTonePromptSet(JSON.stringify({ ...SET, prompts: SET.prompts.slice(1) }));
    expect(!short.ok && short.error.params).toEqual({ rule: 'promptSet' });
    const moved = readTonePromptSet(
      JSON.stringify({ ...SET, prompts: SET.prompts.map((p) => ({ ...p, language: 'en' })) }),
    );
    expect(!moved.ok && moved.error.detail).toMatch(/prompts in hi/);
    expect(loadTonePromptSet(join(ROOT, 'no-such-file.json')).ok).toBe(false);
  });
});

describe('the lock: SOUL.md and the prompt set change apart', () => {
  it('the committed lock ends at the current SOUL.md and prompt set', () => {
    // Failing here: SOUL.md or tone-prompts.json changed without a new lock entry (and a re-recorded session).
    expect(toneLockProblems(LOCK, CURRENT)).toEqual([]);
  });

  it('refuses a step that changes both, and a SOUL.md change without a version bump', () => {
    const lock = {
      entries: [
        entry('1.0.0', 'a', '1'),
        entry('1.1.0', 'b', '1'), // SOUL.md, bumped: fine
        entry('1.1.0', 'b', '2'), // the prompt set alone: fine
        entry('1.2.0', 'c', '3'), // both at once
        entry('1.2.0', 'd', '3'), // SOUL.md without a bump
        entry('1.1.9', 'e', '3'), // a lower version
      ],
    };
    expect(toneLockProblems(lock, entry('1.1.9', 'e', '3'))).toEqual([
      'Entry 4 changes SOUL.md and the prompt set together: change them separately.',
      'Entry 5 changes SOUL.md without bumping its version (1.2.0).',
      'Entry 6 changes SOUL.md without bumping its version (1.2.0).',
    ]);
  });

  it('files that moved past the lock are named', () => {
    const lock = { entries: [entry('1.0.0', 'a', '1')] };
    expect(toneLockProblems(lock, entry('1.0.0', 'a', '2'))[0]).toMatch(/append an entry to tone-lock.json/);
    expect(toneLockProblems(lock, entry('1.0.1', 'a', '1'))).toHaveLength(1);
  });

  // It runs git: on a loaded machine (a full check beside other lanes' suites) that can take well over 5 s.
  it('an uncommitted change never touches both files at once', { timeout: 30_000 }, () => {
    let changed: string[];
    try {
      changed = execFileSync(
        'git',
        ['diff', '--name-only', 'HEAD', '--', 'SOUL.md', 'packages/agent/src/soul/tone-prompts.json'],
        {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      )
        .split('\n')
        .filter(Boolean);
    } catch {
      // Not a git checkout (a source tarball): the lock chain above is the whole check.
      changed = [];
    }
    expect(changed.length).toBeLessThan(2);
  });
});
