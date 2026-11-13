// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a listening suite (EAR1-I3) reports: its numbers, each judged against its bar in ci-paths.json
 * (`thresholds[<suite>]`), and whether it ran. A suite whose models, FFmpeg or labelled set aren't here is skipped
 * with the reason, which is not a failure; a part of a suite can be skipped while the rest runs (listen-parity's
 * end-to-end part without the models). A number without a bar is reported, never judged.
 */
import type { MetricPoint, SuiteEnvelope } from '../envelope';
import { CI_PATHS, featuresOf, type ListenSuiteId } from '../ci/select-suites';

export type ListenStatus = 'pass' | 'fail' | 'skipped';

export interface ListenMetric {
  readonly name: string;
  /** Null when there was nothing to measure (the part ran on no clip). */
  readonly value: number | null;
  readonly better: 'higher' | 'lower';
  /** Which part of the suite measured it (listen-parity: calibration, dsp, critique, realness, fp16, int8). */
  readonly part: string;
  /** The bar from ci-paths.json; undefined for a number that is reported only. */
  readonly bar?: number;
  /** Undefined when there is no bar or no value. */
  readonly pass?: boolean;
  /** What was counted, e.g. "16744 verdicts" or "335 cuts". */
  readonly over?: string;
}

/** A metric as a suite measures it, before the bar is applied. */
export type MeasuredMetric = Omit<ListenMetric, 'bar' | 'pass'>;

export interface SkippedPart {
  readonly part: string;
  readonly reason: string;
}

export interface ListenOutcome {
  readonly suite: ListenSuiteId;
  readonly features: readonly string[];
  readonly status: ListenStatus;
  /** One line: what ran, or why it didn't. */
  readonly detail: string;
  readonly metrics: readonly ListenMetric[];
  readonly skipped: readonly SkippedPart[];
  /** Markdown under the metrics: per-clip or per-case rows, notes. */
  readonly notes: readonly string[];
  readonly seconds: number;
}

const EPSILON = 1e-9;

export function barsOf(suite: ListenSuiteId): Readonly<Record<string, number>> {
  return CI_PATHS.thresholds[suite];
}

/** `metric` against its bar: higher passes at or above it, lower at or below it. */
export function judge(metric: MeasuredMetric, bars: Readonly<Record<string, number>>): ListenMetric {
  const bar = bars[metric.name];
  if (bar === undefined) return metric;
  if (metric.value === null || !Number.isFinite(metric.value)) return { ...metric, bar };
  const pass = metric.better === 'higher' ? metric.value >= bar - EPSILON : metric.value <= bar + EPSILON;
  return { ...metric, bar, pass };
}

/** A suite's outcome from what it measured: it fails when any bar fails, or when a judged number is missing. */
export function outcomeOf(
  suite: ListenSuiteId,
  measured: {
    readonly metrics: readonly MeasuredMetric[];
    readonly skipped?: readonly SkippedPart[];
    readonly notes?: readonly string[];
    readonly seconds: number;
  },
): ListenOutcome {
  const bars = barsOf(suite);
  const metrics = measured.metrics.map((metric) => judge(metric, bars));
  const skipped = measured.skipped ?? [];
  const notes = measured.notes ?? [];
  const features = featuresOf(suite);
  if (metrics.length === 0) {
    const reason = skipped.map((s) => s.reason).join('; ') || 'nothing to measure';
    return {
      suite,
      features,
      status: 'skipped',
      detail: reason,
      metrics,
      skipped,
      notes,
      seconds: measured.seconds,
    };
  }
  const judged = metrics.filter((m) => m.bar !== undefined);
  const failed = judged.filter((m) => m.pass !== true);
  const parts = [...new Set(metrics.map((m) => m.part))].join(', ');
  const detail =
    `${judged.length - failed.length}/${judged.length} bars met (${parts})` +
    (failed.length > 0 ? `; below: ${failed.map((m) => m.name).join(', ')}` : '') +
    (skipped.length > 0 ? `; skipped: ${skipped.map((s) => s.part).join(', ')}` : '');
  return {
    suite,
    features,
    status: failed.length > 0 ? 'fail' : 'pass',
    detail,
    metrics,
    skipped,
    notes,
    seconds: measured.seconds,
  };
}

/** A suite that stopped on an error: a failure, with the message. */
export function crashed(suite: ListenSuiteId, error: unknown, seconds: number): ListenOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return {
    suite,
    features: featuresOf(suite),
    status: 'fail',
    detail: `error: ${message}`,
    metrics: [],
    skipped: [],
    notes: [],
    seconds,
  };
}

/** The `report.json` envelope, so `compare` can diff the numbers against main's. */
export function envelopeOf(outcome: ListenOutcome): SuiteEnvelope & { status: ListenStatus } {
  const metrics: MetricPoint[] = outcome.metrics.flatMap((m) =>
    m.value === null ? [] : [{ name: m.name, value: m.value, better: m.better }],
  );
  return {
    suite: outcome.suite,
    synthetic: false,
    claimed: outcome.status !== 'skipped',
    gate: { id: outcome.features.join(' '), pass: outcome.status !== 'fail', detail: outcome.detail },
    metrics,
    status: outcome.status,
  };
}
