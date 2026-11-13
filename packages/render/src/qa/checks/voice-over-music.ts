// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * voiceOverMusic (P3-V6, SPEC P3.10; audio SPEC P3.5): the voice stays at least `marginLu` (8) above the
 * music in short-term loudness on every frame voice covers, as the ducking planner measured on the rendered
 * stems. Skipped without voice or music (or without a planner to measure it). The fix raises the margin, or
 * turns ducking on when it was off; at the top of the margin's range it lowers the floor instead.
 */
import {
  MIX_COMMANDS,
  type DuckingSettings,
  type QaCheckResult,
  type VoiceOverMusicReport,
} from '@taalcut/core';
import { checkResult, commandFix, skipped, type QaFinding, type QaTarget } from '../result';

/** core's duckingSettingsSchema bounds. */
const MAX_MARGIN_LU = 20;
const MIN_FLOOR_DB = -40;

export interface VoiceOverMusicInput {
  /** The planner's report (export-mix.ts); null when there was no voice, no music or no planner. */
  readonly report: VoiceOverMusicReport | null;
  readonly settings: DuckingSettings;
  readonly target: QaTarget;
  /** Render frames per second, to place the worst moments as findings. */
  readonly fps: number;
  readonly durationMs?: number;
}

/** The setting change that gives the voice more room. */
function patchFor(settings: DuckingSettings): Partial<DuckingSettings> {
  if (!settings.enabled) return { enabled: true };
  if (settings.marginLu + 2 <= MAX_MARGIN_LU) return { marginLu: settings.marginLu + 2 };
  return { floorDb: Math.max(MIN_FLOOR_DB, settings.floorDb - 6) };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function voiceOverMusicCheck(input: VoiceOverMusicInput): QaCheckResult {
  const { report, settings } = input;
  const duration = input.durationMs ?? 0;
  if (!report || report.counted === 0 || report.minMarginLu === null)
    return skipped('voiceOverMusic', duration);
  const findings: QaFinding[] = report.worst.slice(0, 5).map((moment) => {
    const frame = Math.max(0, Math.floor((moment.atMs / 1000) * input.fps));
    return {
      frames: { start: frame, end: frame + 1 },
      target: { kind: 'audio', id: 'music' },
      measured: { value: round2(moment.voiceLufs - moment.musicLufs), unit: 'lu' },
    };
  });
  const passed = report.passed && report.minMarginLu >= report.marginLu;
  return checkResult(
    'voiceOverMusic',
    passed ? 'pass' : 'fail',
    {
      measured: { value: round2(report.minMarginLu), unit: 'lu' },
      threshold: { min: report.marginLu, unit: 'lu' },
      findings: passed ? [] : findings,
      fixes: [
        commandFix('qa.fixes.raiseDucking', MIX_COMMANDS.setDucking, {
          ...input.target,
          ducking: patchFor(settings),
        }),
      ],
    },
    duration,
  );
}
