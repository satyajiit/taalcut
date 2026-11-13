// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { absentCell, DEFAULT_MIN_N, formatShare, oneCell, type GateMetric } from '../gate-metric';
import { isPresent } from '../inputs/types';
import { shareMeasured } from '../share';

/**
 * The breakdown runner's own headline, so the dashboard and the eval report show one number: the share of reels at
 * the per-reel bar (at least 90% of true cuts within 2 frames, FORMAT.md). The alpha gate used the same number.
 */
export const breakdownAccuracy: GateMetric = {
  id: 'breakdownAccuracy',
  label: 'Breakdown accuracy',
  source: 'eval',
  bindings: [
    {
      gate: 'beta',
      row: 6,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.88, unit: 'share' },
    },
    {
      gate: 'v1',
      row: 1,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.9, unit: 'share' },
    },
  ],
  compute(inputs, binding) {
    if (!isPresent(inputs.evals) || inputs.evals.breakdown === null) {
      return [absentCell(this, binding, 'breakdown report absent')];
    }
    const report = inputs.evals.breakdown;
    return [
      oneCell(
        this,
        binding,
        [report.source],
        report.source.synthetic,
        shareMeasured(
          report.reelsMeetingBar,
          report.reels,
          `reels at the per-reel bar; every cut within 2 frames ${formatShare(report.cutShare)}; reels with no missed cut ${report.missedEmpty}/${report.reels}`,
        ),
      ),
    ];
  },
};
