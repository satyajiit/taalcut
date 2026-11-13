// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** stylePacing (LRN1-STY): the render's median shot against the pacing band of the set the project follows. */
import { stylePacingCheck } from '../checks/style-pacing';
import { skipped } from '../result';
import type { QaCheckModule } from './module';

export const stylePacingQaModule: QaCheckModule = {
  ids: ['stylePacing'],
  probeFrames: () => [],
  async run({ run, facts }, wanted) {
    if (!wanted.has('stylePacing')) return [];
    const pacing = facts.stylePacing;
    if (!pacing) return [skipped('stylePacing')];
    return [stylePacingCheck({ ...pacing, rate: { num: run.plan.rateNum, den: run.plan.rateDen } })];
  },
};
