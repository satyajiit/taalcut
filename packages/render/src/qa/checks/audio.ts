// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * loudness and silence (docs/qa-gate.md). A silent path-a export skips
 * loudness on purpose; silence covers that case both ways: a silent plan
 * must be silent, and a plan with sound must not have lost it.
 */
import type { ExportPreset, QaCheckResult } from '@taalcut/core';
import type { QaPlan } from '../../types';
import type { AudioLevels } from '../measure/audio-pass';
import { autoFix, checkResult, skipped } from '../result';
import { QA_THRESHOLDS } from '../thresholds.v1';

const finite = (value: number, floor: number) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : floor);

export function loudnessCheck(levels: AudioLevels, plan: QaPlan, preset: ExportPreset): QaCheckResult {
  if (plan.audio.silent) return skipped('loudness');
  const { integratedLufs, toleranceLu, truePeakDbtp } = preset.loudness;
  const lufs = levels.integratedLufs;
  const inBand = Math.abs(lufs - integratedLufs) <= toleranceLu;
  const peakOk = levels.truePeakDbtp <= truePeakDbtp;
  const findings = [
    ...(inBand ? [] : [{ target: { kind: 'audio' as const, id: 'integrated' }, measured: { value: finite(lufs, -70), unit: 'lufs' as const } }]),
    ...(peakOk
      ? []
      : [{ target: { kind: 'audio' as const, id: 'truePeak' }, measured: { value: finite(levels.truePeakDbtp, -99), unit: 'dbtp' as const } }]),
  ];
  return checkResult(
    'loudness',
    findings.length === 0 ? 'pass' : 'fail',
    {
      measured: { value: finite(lufs, -70), unit: 'lufs' },
      threshold: { min: integratedLufs - toleranceLu, max: integratedLufs + toleranceLu, unit: 'lufs' },
      findings,
      fixes: [autoFix('renormaliseAudio')],
    },
    0,
  );
}

export function silenceCheck(levels: AudioLevels, plan: QaPlan): QaCheckResult {
  const limit = QA_THRESHOLDS.silence.maxVolumeDb;
  const silent = levels.maxVolumeDb <= limit;
  const ok = plan.audio.silent ? silent : !silent;
  return checkResult(
    'silence',
    ok ? 'pass' : 'fail',
    {
      measured: { value: finite(levels.maxVolumeDb, -99), unit: 'db' },
      threshold: plan.audio.silent ? { max: limit, unit: 'db' } : { min: limit, unit: 'db' },
      findings: ok ? [] : [{ target: { kind: 'audio', id: plan.audio.silent ? 'unexpectedSound' : 'lostSound' } }],
      // The engine re-runs the mix for this check, then renormalises and remuxes.
      fixes: [autoFix('renormaliseAudio')],
    },
    0,
  );
}
