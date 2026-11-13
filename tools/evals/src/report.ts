// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { writeJson, writeText } from './files';
import { type AggregateScore, type EvalReport, type ReelScore } from './metric';

function rate(value: number): string {
  return value.toFixed(3);
}

function frameList(frames: readonly number[]): string {
  return frames.length === 0 ? 'none' : frames.join(', ');
}

function fps(reel: ReelScore): string {
  return `${reel.frameRate.numerator}/${reel.frameRate.denominator}`;
}

function scoreCells(score: {
  precision: number;
  recall: number;
  f1: number;
  withinToleranceShare: number;
}): string {
  return [rate(score.precision), rate(score.recall), rate(score.f1), rate(score.withinToleranceShare)].join(
    ' | ',
  );
}

function aggregateRow(score: AggregateScore): string {
  const share = `${score.reelsMeetingBar}/${score.reelCount}`;
  return `| ${scoreCells(score)} | ${share} |`;
}

function reelRow(reel: ReelScore): string {
  const cells = [
    reel.reelId,
    fps(reel),
    reel.truthCuts.length,
    reel.predictedCuts.length,
    reel.tp,
    reel.fp,
    reel.fn,
    scoreCells(reel),
    reel.meetsBar ? 'yes' : 'no',
  ];
  return `| ${cells.join(' | ')} |`;
}

function gateLine(report: EvalReport): string {
  const share = `${report.aggregate.reelsMeetingBar}/${report.aggregate.reelCount}`;
  const detail = `${share} reels clear the per-reel bar (${rate(report.gate3.perReelBar)} of cuts within ${report.toleranceFrames} frames). Gate criterion 3 needs ${rate(report.gate3.reelShareBar)}.`;
  if (!report.gate3.claimed) {
    return `Synthetic: yes. These numbers are not a gate result. ${detail}`;
  }
  return `Synthetic: no. Gate criterion 3: ${report.gate3.pass ? 'pass' : 'fail'}. ${detail}`;
}

export function renderMarkdown(report: EvalReport): string {
  const lines = [
    '# Breakdown cut accuracy',
    '',
    gateLine(report),
    '',
    `Tolerance is ±${report.toleranceFrames} frames. A predicted cut matches one true cut when the distance is at most ${report.toleranceFrames} frames.`,
    'Matching is one-to-one and greedy: shortest distance, then the true frame, then the predicted frame.',
    `A reel clears the bar when at least ${rate(report.bar)} of its true cuts match. A reel with no true cuts clears it.`,
    '',
    '## Aggregate',
    '',
    'Precision, recall, and F1 are micro scores (every cut counts once). The last column is the share of reels that clear the bar.',
    '',
    '| Precision | Recall | F1 | Within 2 | Reels at bar |',
    '| --- | --- | --- | --- | --- |',
    aggregateRow(report.aggregate),
    '',
    '## Per reel',
    '',
    '| Reel | Frame rate | Truth | Pred | TP | FP | FN | Precision | Recall | F1 | Within 2 | At bar |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.reels.map(reelRow),
    '',
  ];
  for (const reel of report.reels) {
    const marker = reel.synthetic ? ' Synthetic sample.' : '';
    lines.push(`### ${reel.reelId}`, '', `Frame rate ${fps(reel)}.${marker}`, '');
    lines.push(`Missed true cuts: ${frameList(reel.missedTruths)}`);
    lines.push(`Unmatched predictions: ${frameList(reel.unmatchedPredictions)}`, '');
  }
  return `${lines.join('\n')}\n`;
}

export function renderJson(report: EvalReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function jsonPathFor(markdownPath: string): string {
  return markdownPath.endsWith('.md') ? `${markdownPath.slice(0, -3)}.json` : `${markdownPath}.json`;
}

/** A suite's report: the Markdown at `markdownPath`, the same report as JSON beside it (`jsonPathFor`). */
export function writeReport(markdownPath: string, markdown: string, report: unknown): void {
  writeText(markdownPath, markdown);
  writeJson(jsonPathFor(markdownPath), report);
}
