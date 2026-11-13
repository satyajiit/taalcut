// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One number the PR compare report can diff. `better` says which direction is a win. */
export interface MetricPoint {
  name: string;
  value: number;
  better: 'higher' | 'lower';
  unit?: string;
}

/**
 * Every suite's `report.json` carries this so `compare` can show the change
 * against `main` without knowing the suite. `claimed` is false for synthetic
 * input: those numbers are never a gate result.
 */
export interface SuiteEnvelope {
  suite: string;
  synthetic: boolean;
  /** False when any input is synthetic, or when the suite does not gate. */
  claimed: boolean;
  gate?: { id: string; pass: boolean; detail: string };
  metrics: MetricPoint[];
}

export function envelopeBlock(envelope: SuiteEnvelope): string {
  const synthetic = envelope.synthetic
    ? 'Synthetic: yes. These numbers are not a gate result.'
    : 'Synthetic: no.';
  const gate =
    envelope.gate === undefined
      ? ''
      : envelope.claimed
        ? `Gate ${envelope.gate.id}: ${envelope.gate.pass ? 'pass' : 'fail'}. ${envelope.gate.detail}`
        : `Gate ${envelope.gate.id} is not claimed. ${envelope.gate.detail}`;
  return [synthetic, gate].filter((line) => line.length > 0).join('\n');
}
