// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { isPresent, type CiResult, type GateInputs, type ManualRow } from '../inputs/types';

export function findCi(inputs: GateInputs, id: string): CiResult | undefined {
  if (!isPresent(inputs.ci)) return undefined;
  return inputs.ci.results.find((result) => result.id === id);
}

export function findManual(inputs: GateInputs, gate: ManualRow['gate'], row: number): ManualRow | undefined {
  if (!isPresent(inputs.manual)) return undefined;
  return inputs.manual.rows.find((entry) => entry.gate === gate && entry.row === row);
}
