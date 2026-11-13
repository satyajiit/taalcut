// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { absentCell, oneCell, type GateBinding, type GateMetric } from '../gate-metric';
import { isPresent, type CiResult, type GateInputs, type ManualRow, type SourceRef } from '../inputs/types';
import { findCi, findManual } from './lookup';

/** Either side missing is missing input, even when the other side has already passed or failed. */
export function requireBoth(
  metric: Pick<GateMetric, 'id' | 'label'>,
  binding: GateBinding,
  inputs: GateInputs,
  ciId: string,
  manualRow: number,
): ReturnType<GateMetric['compute']> {
  const ci = findCi(inputs, ciId);
  const signed = findManual(inputs, binding.gate, manualRow);
  const manualSource: SourceRef | null = isPresent(inputs.manual) ? inputs.manual.source : null;
  if (ci === undefined || signed === undefined) {
    return [
      absentCell(
        metric,
        binding,
        sideText(ci, signed, manualRow),
        sourcesOf(ci, manualSource),
        syntheticOf(ci, inputs),
      ),
    ];
  }
  const sources = sourcesOf(ci, manualSource);
  const pass = ci.pass && signed.pass;
  return [
    oneCell(metric, binding, sources, syntheticOf(ci, inputs), {
      value: pass ? 1 : 0,
      n: 1,
      interval: null,
      detail: `ci ${ci.pass ? 'pass' : 'fail'}; manual row ${manualRow} ${signed.pass ? 'pass' : 'fail'}`,
      display: pass ? 'pass' : 'fail',
    }),
  ];
}

function sideText(ci: CiResult | undefined, signed: ManualRow | undefined, row: number): string {
  const ciText = ci === undefined ? 'ci absent' : `ci ${ci.pass ? 'pass' : 'fail'}`;
  const manualText =
    signed === undefined ? `manual row ${row} absent` : `manual row ${row} ${signed.pass ? 'pass' : 'fail'}`;
  return `${ciText}; ${manualText}`;
}

function sourcesOf(ci: CiResult | undefined, manual: SourceRef | null): SourceRef[] {
  const sources: SourceRef[] = [];
  if (ci !== undefined) sources.push(ci.source);
  if (manual !== null) sources.push(manual);
  return sources;
}

function syntheticOf(ci: CiResult | undefined, inputs: GateInputs): boolean {
  return ci?.synthetic === true || (isPresent(inputs.manual) && inputs.manual.synthetic);
}
