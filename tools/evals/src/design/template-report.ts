// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template mode's report (HFW1 tpl): each case's pass or why not, its briefs (design.done, the gate, turns,
 * renders, refusals), each overlay's design against the reel's (TEMPLATE_TOLERANCES) and its minutes, as
 * design.json and design.md in `--out`. Every case must pass: the owner's flow has no partial credit.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TEMPLATE_TOLERANCES, type TemplateCaseOutcome } from './template-run';

export interface TemplateReport {
  readonly mode: 'template';
  readonly label: string;
  readonly tolerances: typeof TEMPLATE_TOLERANCES & { readonly lines: 'equal' };
  readonly passed: number;
  readonly total: number;
  readonly minutes: number;
  readonly topRefusals: readonly { readonly code: string; readonly count: number }[];
  readonly cases: readonly TemplateCaseOutcome[];
}

export function templateReport(label: string, cases: readonly TemplateCaseOutcome[]): TemplateReport {
  const counts = new Map<string, number>();
  for (const code of cases.flatMap((entry) => entry.briefs.flatMap((brief) => brief.refusals)))
    counts.set(code, (counts.get(code) ?? 0) + 1);
  return {
    mode: 'template',
    label,
    tolerances: { ...TEMPLATE_TOLERANCES, lines: 'equal' },
    passed: cases.filter((entry) => entry.pass).length,
    total: cases.length,
    minutes: Math.round(cases.reduce((sum, entry) => sum + entry.minutes, 0) * 10) / 10,
    topRefusals: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code, count]) => ({ code, count })),
    cases,
  };
}

export function templateMarkdown(report: TemplateReport): string {
  const percent = (value: number) => `${Math.round(value * 100)} %`;
  const lines = [
    `# eval:design --template (${report.label})`,
    '',
    `${report.passed} / ${report.total} passed, ${report.minutes} min. A design passes when its middle is within ` +
      `${percent(report.tolerances.position)} of the canvas of the reel's, each side within ${percent(report.tolerances.size)}, ` +
      'on as many lines.',
    '',
    '| case | result | min | briefs (turns, renders) |',
    '| --- | --- | --- | --- |',
    ...report.cases.map(
      (entry) =>
        `| ${entry.id} | ${entry.pass ? 'pass' : `FAIL: ${entry.why ?? ''}`} | ${entry.minutes} | ` +
        `${entry.briefs.map((brief) => `${brief.role} (${brief.turns}, ${brief.renders})`).join('; ')} |`,
    ),
    '',
    report.topRefusals.length
      ? `Top refusals: ${report.topRefusals.map((entry) => `\`${entry.code}\` ${entry.count}`).join(', ')}.`
      : 'No refusals.',
  ];
  return lines.join('\n');
}

export async function writeTemplateReport(report: TemplateReport, out: string): Promise<void> {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'design.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(out, 'design.md'), `${templateMarkdown(report)}\n`);
}
