// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The voiceOverMusic QA check (P3-V6, SPEC P3.10) from the planner's report. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DUCKING,
  mixCommandPayloads,
  MIX_COMMANDS,
  newId,
  qaCheckResultSchema,
  type VoiceOverMusicReport,
} from '@taalcut/core';
import { voiceOverMusicCheck } from '../../src/qa/checks/voice-over-music';

const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };
const report = (minMarginLu: number | null, counted = 40): VoiceOverMusicReport => ({
  frames: 100,
  counted,
  marginLu: 8,
  minMarginLu,
  worst:
    minMarginLu === null
      ? []
      : [
          { atMs: 4200, voiceLufs: -20, musicLufs: -20 - minMarginLu },
          { atMs: 6100, voiceLufs: -21, musicLufs: -30 },
        ],
  passed: minMarginLu !== null && minMarginLu >= 8,
});

const fixPayload = (result: ReturnType<typeof voiceOverMusicCheck>) => {
  const fix = result.fixes[0];
  return fix?.kind === 'command' ? fix.payload : null;
};

describe('voiceOverMusicCheck', () => {
  it('is skipped without voice or music, or when no frame had enough voice to count', () => {
    for (const input of [null, report(null, 0)])
      expect(voiceOverMusicCheck({ report: input, settings: DEFAULT_DUCKING, target, fps: 30 }).status).toBe(
        'skipped',
      );
  });

  it('passes at the margin, measured in LU', () => {
    const result = voiceOverMusicCheck({ report: report(9.42), settings: DEFAULT_DUCKING, target, fps: 30 });
    expect(qaCheckResultSchema.parse(result)).toMatchObject({
      id: 'voiceOverMusic',
      status: 'pass',
      measured: { value: 9.42, unit: 'lu' },
      threshold: { min: 8, unit: 'lu' },
      findings: [],
    });
  });

  it('fails under it, with the worst moments and a music.setDucking fix that raises the margin by 2', () => {
    const result = voiceOverMusicCheck({ report: report(3.5), settings: DEFAULT_DUCKING, target, fps: 30 });
    expect(result.status).toBe('fail');
    expect(result.findings[0]).toMatchObject({
      frames: { start: 126, end: 127 },
      measured: { value: 3.5, unit: 'lu' },
    });
    expect(result.fixes[0]).toMatchObject({ kind: 'command', command: MIX_COMMANDS.setDucking });
    const payload = fixPayload(result);
    expect(payload).toEqual({ ...target, ducking: { marginLu: 10 } });
    // What the fix carries is a valid command payload.
    expect(mixCommandPayloads[MIX_COMMANDS.setDucking].safeParse(payload).success).toBe(true);
  });

  it('turns ducking on when it was off, and lowers the floor once the margin is at its top', () => {
    const off = voiceOverMusicCheck({
      report: report(-4),
      settings: { ...DEFAULT_DUCKING, enabled: false },
      target,
      fps: 30,
    });
    expect(fixPayload(off)).toEqual({ ...target, ducking: { enabled: true } });
    const top = voiceOverMusicCheck({
      report: report(5),
      settings: { ...DEFAULT_DUCKING, marginLu: 20 },
      target,
      fps: 30,
    });
    expect(fixPayload(top)).toEqual({ ...target, ducking: { floorDb: -36 } });
    for (const result of [off, top])
      expect(mixCommandPayloads[MIX_COMMANDS.setDucking].safeParse(fixPayload(result)).success).toBe(true);
  });
});
