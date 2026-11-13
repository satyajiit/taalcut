// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type GateInputs, type SourceRef } from './inputs/types';
import { type CellSlice, type CohortSlice, type GateId, type LanguageSlice } from './slices';

export type { CellSlice, CohortSlice, GateId, LanguageSlice };

/** Below this many observations a rate is `too few`, not a pass. Activation's beta cohort is 30. */
export const DEFAULT_MIN_N = 20;

export type Verdict = 'pass' | 'fail' | 'too few' | 'missing input';

export type CompareOp = '>=' | '<=' | '>' | '<';

/** A numeric bar. `value` is in `unit` (a share is 0–1, not a percent). */
export interface NumericTarget {
  op: CompareOp;
  value: number;
  unit: string;
}

/** A signed checklist row. `value` stays null: pass/fail is not a quantity. */
export interface PassTarget {
  op: 'pass';
  value: null;
  unit: string;
}

export type Target = NumericTarget | PassTarget;

export interface Interval {
  low: number;
  high: number;
}

export interface GateCell {
  metricId: string;
  gate: GateId;
  row: number;
  label: string;
  slice: CellSlice;
  value: number | null;
  display: string;
  target: Target;
  verdict: Verdict;
  n: number | null;
  interval: Interval | null;
  sources: SourceRef[];
  synthetic: boolean;
  detail: string;
  /** The go/no-go cell for its row: the binding's cohort, all languages, no release, channel or runner. */
  decides: boolean;
}

/** One gate row this metric is responsible for. A module may carry a beta row and a v1 row. */
export interface GateBinding {
  gate: GateId;
  row: number;
  /** The slice the go/no-go cell uses. Other slices are still reported. */
  cohort: CohortSlice;
  minN: number;
  target: Target;
}

export interface GateMetric {
  id: string;
  label: string;
  source: string;
  bindings: readonly GateBinding[];
  compute(inputs: GateInputs, binding: GateBinding): GateCell[];
}

export interface Measured {
  value: number | null;
  n: number | null;
  interval: Interval | null;
  detail: string;
  /** Ignored when `value` is null and no `verdict` is set: the display is then `no data`. */
  display: string;
  /** Set when pass/fail is not a straight comparison of `value` with the target. */
  verdict?: Verdict;
  synthetic?: boolean;
  sources?: SourceRef[];
  /** Overrides the slice rule for a metric whose go/no-go cell is computed apart from its slices. */
  decides?: boolean;
}

function isGateSlice(binding: GateBinding, slice: CellSlice): boolean {
  return (
    slice.cohort === binding.cohort &&
    slice.language === 'all' &&
    slice.release === undefined &&
    slice.channel === undefined &&
    slice.runner === undefined
  );
}

const VERDICT_SEVERITY: Record<Verdict, number> = { fail: 0, 'missing input': 1, 'too few': 2, pass: 3 };

/** A row passes only when every deciding cell passes. Otherwise the worst verdict: fail, missing input, too few. */
export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  let worst: Verdict = 'pass';
  for (const verdict of verdicts) {
    if (VERDICT_SEVERITY[verdict] < VERDICT_SEVERITY[worst]) worst = verdict;
  }
  return verdicts.length === 0 ? 'missing input' : worst;
}

/** True when `value` meets the bar. A difference within 1e-9 of the target is the boundary, and it passes `>=` / `<=`. */
export function meetsTarget(value: number, target: NumericTarget): boolean {
  const scale = Math.max(1, Math.abs(target.value));
  const onBoundary = Math.abs(value - target.value) <= 1e-9 * scale;
  if (target.op === '>=') return value > target.value || onBoundary;
  if (target.op === '<=') return value < target.value || onBoundary;
  if (target.op === '>') return value > target.value && !onBoundary;
  return value < target.value && !onBoundary;
}

/**
 * `n === 0` with a null value is missing, not zero and not `too few`: there was nothing to count.
 * `too few` is only when a real value exists and the sample is under `minN`.
 */
export function judgeSample(value: number | null, n: number | null, target: Target, minN: number): Verdict {
  if (value === null || n === null) return 'missing input';
  if (n < minN) return 'too few';
  if (target.op === 'pass') return value === 1 ? 'pass' : 'fail';
  return meetsTarget(value, target) ? 'pass' : 'fail';
}

export function formatShare(value: number): string {
  const percent = (value * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `${percent}%`;
}

export function formatMinutes(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return `${text} min`;
}

export function formatUsd(value: number): string {
  const text = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `$${text}`;
}

export function formatTarget(target: Target): string {
  if (target.op === 'pass' || target.value === null) return 'pass';
  const shown = target.unit === 'share' ? formatShare(target.value) : `${target.value} ${target.unit}`;
  return `${target.op} ${shown}`;
}

export function markedSynthetic(sources: readonly SourceRef[]): boolean {
  return sources.some((source) => source.synthetic);
}

function finish(
  metric: Pick<GateMetric, 'id' | 'label'>,
  binding: GateBinding,
  slice: CellSlice,
  sources: readonly SourceRef[],
  synthetic: boolean,
  measured: Measured,
): GateCell {
  const value = measured.value;
  const n = measured.n;
  const usedSources = measured.sources ?? sources;
  return {
    metricId: metric.id,
    gate: binding.gate,
    row: binding.row,
    label: metric.label,
    slice,
    value,
    display: value === null && measured.verdict === undefined ? 'no data' : measured.display,
    target: binding.target,
    verdict: measured.verdict ?? judgeSample(value, n, binding.target, binding.minN),
    n,
    interval: value === null ? null : measured.interval,
    sources: [...usedSources],
    synthetic: measured.synthetic ?? synthetic,
    detail: measured.detail,
    decides: measured.decides ?? isGateSlice(binding, slice),
  };
}

export function oneCell(
  metric: Pick<GateMetric, 'id' | 'label'>,
  binding: GateBinding,
  sources: readonly SourceRef[],
  synthetic: boolean,
  measured: Measured,
  slice: CellSlice = { cohort: binding.cohort, language: 'all' },
): GateCell {
  return finish(metric, binding, slice, sources, synthetic, measured);
}

/** The source was not passed on the CLI. One cell, on the gate slice. Never a zero. */
export function absentCell(
  metric: Pick<GateMetric, 'id' | 'label'>,
  binding: GateBinding,
  detail: string,
  sources: readonly SourceRef[] = [],
  synthetic = false,
): GateCell {
  return finish(metric, binding, { cohort: binding.cohort, language: 'all' }, sources, synthetic, {
    value: null,
    n: null,
    interval: null,
    detail,
    display: 'no data',
    verdict: 'missing input',
  });
}

export function mapSlices(
  metric: Pick<GateMetric, 'id' | 'label'>,
  binding: GateBinding,
  sources: readonly SourceRef[],
  synthetic: boolean,
  slices: readonly CellSlice[],
  measure: (slice: CellSlice) => Measured,
): GateCell[] {
  return slices.map((slice) => finish(metric, binding, slice, sources, synthetic, measure(slice)));
}

export function proportionMeasured(successes: number, n: number, detail: string): Measured {
  if (n === 0) {
    return { value: null, n: 0, interval: null, detail, display: 'no data' };
  }
  const value = successes / n;
  return {
    value,
    n,
    interval: null,
    detail: detail === '' ? `${successes}/${n}` : `${successes}/${n}; ${detail}`,
    display: formatShare(value),
  };
}
