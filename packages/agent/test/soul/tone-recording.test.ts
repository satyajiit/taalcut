// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B15's tone evals on the committed recording, replayed offline (SPEC section 22). It must answer the
 * current SOUL.md and prompt set (a version bump means re-recording). Until the PO records it with real keys
 * (support/tone-models.ts has the command) it is a stand-in recording and its report is "unmeasured"; a real
 * one must pass on all three providers. TAALCUT_RECORD=1 records it again first.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { loadTonePromptSet, loadToneRecording, readSoul, toneReport } from '@taalcut/agent';
import { cassetteModeFromEnv } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { recordToneSession } from './support/tone-models';

const SOUL = unwrap(
  readSoul(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'SOUL.md'), 'utf8')),
);
const { set, sha256 } = unwrap(loadTonePromptSet());

describe('the recorded tone session', { timeout: 600_000 }, () => {
  it('answers the current SOUL.md and prompt set, and reports as what it is', async () => {
    if (cassetteModeFromEnv() === 'record')
      await recordToneSession({
        soul: SOUL,
        prompts: set.prompts,
        promptSetSha256: sha256,
        today: '2026-10-14',
      });
    const recording = unwrap(loadToneRecording());
    // Failing here: SOUL.md or the prompt set changed; re-record (see support/tone-models.ts).
    expect({ soulVersion: recording.soulVersion, promptSetSha256: recording.promptSetSha256 }).toEqual({
      soulVersion: SOUL.version,
      promptSetSha256: sha256,
    });
    const report = unwrap(
      toneReport({
        prompts: set.prompts,
        recording,
        current: { soulVersion: SOUL.version, promptSetSha256: sha256 },
      }),
    );
    expect(report.n).toBe(60);
    expect(report.judgeValid).toBe(true);
    if (recording.standIn) {
      expect(report.status).toBe('unmeasured');
      expect(report.reasons[0]).toMatch(/stand-in/);
    } else {
      expect(report.reasons).toEqual([]);
      expect(report.status).toBe('passed');
    }
  });
});
