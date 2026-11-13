// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { envelopeBlock, type MetricPoint } from '../envelope';
import { type FrameMismatch, type HashCheck } from './check';

export interface RenderGoldenScore {
  id: string;
  synthetic: boolean;
  cutTiming: boolean;
  beatGrid: boolean;
  audioDrift: boolean;
  hashes: Pick<HashCheck, 'approved' | 'pass'>;
  qaPassed?: boolean;
  firstMismatch?: FrameMismatch;
}

export interface RenderReport {
  suite: 'render';
  synthetic: boolean;
  claimed: boolean;
  gate: { id: '5'; pass: boolean; detail: string };
  metrics: MetricPoint[];
  qaNote: string;
  goldens: RenderGoldenScore[];
}

function flag(pass: boolean): string {
  return pass ? 'pass' : 'fail';
}

function hashCell(hashes: Pick<HashCheck, 'approved' | 'pass'>): string {
  if (!hashes.approved) return 'skipped';
  return flag(hashes.pass);
}

function qaCell(qaPassed: boolean | undefined): string {
  if (qaPassed === undefined) return 'not run';
  return qaPassed ? 'pass' : 'fail';
}

export function renderMarkdown(report: RenderReport): string {
  const lines = [
    '# Render goldens',
    '',
    envelopeBlock(report),
    '',
    report.qaNote,
    '',
    '| Golden | Cut timing | Beat grid | Audio drift | Hashes | QA |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.goldens.map(
      (golden) =>
        `| ${golden.id} | ${flag(golden.cutTiming)} | ${flag(golden.beatGrid)} | ${flag(golden.audioDrift)} | ${hashCell(golden.hashes)} | ${qaCell(golden.qaPassed)} |`,
    ),
    '',
  ];
  for (const golden of report.goldens) {
    const mismatch = golden.firstMismatch;
    if (mismatch === undefined) continue;
    lines.push(
      `${golden.id} cut mismatch at output frame ${mismatch.outputFrame}: expected clip ${mismatch.expected.clipId} source ${mismatch.expected.frame}, got clip ${mismatch.actual.clipId} source ${mismatch.actual.frame}.`,
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

export function renderJson(report: RenderReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
