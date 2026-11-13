// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import { REFRAME_BARS, type ReframeClipScore } from './metric';

export interface ReframeReport {
  suite: 'reframe';
  synthetic: boolean;
  claimed: boolean;
  gate: { id: 'P3-V2'; pass: boolean; detail: string };
  metrics: SuiteEnvelope['metrics'];
  clips: ReframeClipScore[];
}

export function renderReframeMarkdown(report: ReframeReport): string {
  const lines = ['# Reframe eval', '', envelopeBlock(report), ''];
  const subject = report.metrics.find((metric) => metric.name === 'subjectInFrame');
  const jitter = report.metrics.find((metric) => metric.name === 'jitterFrames');
  const fallback = report.metrics.find((metric) => metric.name === 'fallbackFrames');
  const missed = report.metrics.find((metric) => metric.name === 'fallbackMissed');
  const shown = subject === undefined ? 'no data (no labelled subject)' : subject.value.toFixed(3);
  lines.push(
    `subjectInFrame ${shown} (need ${REFRAME_BARS.subjectInFrame}). jitterFrames ${jitter?.value ?? 'no data'} (need ${REFRAME_BARS.jitterFrames}). fallbackFrames ${fallback?.value ?? 'no data'} (no subject: not a failure). Subjectless clips framed as a subject ${missed?.value ?? 'no data'} (need 0).`,
    '',
    '| clip | boxed | inside | fallback | subjectless but followed | jitter |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const clip of report.clips) {
    lines.push(
      `| ${clip.clipId} | ${clip.boxed} | ${clip.inside} | ${clip.fallbackFrames} | ${clip.fallbackMissed ? 'yes' : 'no'} | ${clip.jitterFrames} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
