// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { eventsNamed } from '../events';
import {
  absentCell,
  DEFAULT_MIN_N,
  formatShare,
  judgeSample,
  mapSlices,
  markedSynthetic,
  meetsTarget,
  type CellSlice,
  type GateMetric,
  type NumericTarget,
} from '../gate-metric';
import { isPresent, type InstallRollup } from '../inputs/types';
import { cohortLanguageSlices, matchesSlice } from '../slices';
import { shareMeasured } from '../share';

function castingDetail(inputs: Parameters<GateMetric['compute']>[0]): string {
  if (!isPresent(inputs.evals) || inputs.evals.casting === null) return 'casting pickAcceptance absent';
  const value = inputs.evals.casting.pickAcceptance;
  if (value === null) return 'casting pickAcceptance absent';
  return `casting pickAcceptance ${formatShare(value)} (beside, not the verdict)`;
}

export const autoSelectAcceptance: GateMetric = {
  id: 'autoSelectAcceptance',
  label: 'Auto-select acceptance',
  source: 'telemetry+eval',
  bindings: [
    {
      gate: 'beta',
      row: 5,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.65, unit: 'share' },
    },
    {
      gate: 'v1',
      row: 1,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.7, unit: 'share' },
    },
  ],
  compute(inputs, binding) {
    const beside = castingDetail(inputs);
    const evalSources =
      isPresent(inputs.evals) && inputs.evals.casting !== null ? [inputs.evals.casting.source] : [];
    if (!isPresent(inputs.telemetry)) {
      return [
        absentCell(this, binding, `telemetry absent; ${beside}`, evalSources, markedSynthetic(evalSources)),
      ];
    }
    const target = binding.target;
    if (target.op === 'pass') throw new Error('auto-select target must be numeric');
    const telemetry = inputs.telemetry;
    const sources = [...telemetry.sources, ...evalSources];
    return mapSlices(this, binding, sources, markedSynthetic(sources), cohortLanguageSlices(), (slice) =>
      countSlice(telemetry.installs, slice, target, binding.minN, beside),
    );
  },
};

function countSlice(
  installs: readonly InstallRollup[],
  slice: CellSlice,
  target: NumericTarget,
  minN: number,
  beside: string,
): ReturnType<typeof shareMeasured> {
  let kept = 0;
  let slots = 0;
  let unchanged = 0;
  let exports = 0;
  for (const install of installs) {
    if (!matchesSlice(install.cohort, install.language, slice)) continue;
    for (const envelope of eventsNamed(install.envelopes, 'export.completed')) {
      exports += 1;
      kept += envelope.event.slotsKeptAi;
      slots += envelope.event.slots;
      if (!envelope.event.orderChanged) unchanged += 1;
    }
  }
  if (exports === 0 || slots === 0) return shareMeasured(0, 0, beside);
  const orderShare = unchanged / exports;
  const measured = shareMeasured(kept, slots, `order unchanged ${formatShare(orderShare)}; ${beside}`);
  // `n` is exports (the videos). The value is slots kept over slots, so both bars can be checked.
  measured.n = exports;
  const judged = judgeSample(measured.value, exports, target, minN);
  measured.verdict = judged === 'pass' && !meetsTarget(orderShare, target) ? 'fail' : judged;
  return measured;
}
