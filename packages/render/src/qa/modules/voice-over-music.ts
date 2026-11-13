// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * voiceOverMusic (P3-V6, SPEC P3.10): the ducking planner's report on the export's stems, measured by the
 * mix (export-mix.ts). Skipped when the mix had no voice, no music or no planner; a re-check after an auto
 * fix reads the same report, since the mix is unchanged.
 */
import { voiceOverMusicCheck } from '../checks/voice-over-music';
import { skipped } from '../result';
import type { QaCheckModule } from './module';

export const voiceOverMusicQaModule: QaCheckModule = {
  ids: ['voiceOverMusic'],
  probeFrames: () => [],
  async run({ run, facts }, wanted) {
    if (!wanted.has('voiceOverMusic')) return [];
    const sound = facts.voiceOverMusic;
    if (!sound) return [skipped('voiceOverMusic')];
    return [
      voiceOverMusicCheck({
        report: sound.report,
        settings: sound.settings,
        target: run.target,
        fps: run.plan.rateNum / run.plan.rateDen,
      }),
    ];
  },
};
