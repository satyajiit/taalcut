// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The design eval's report (HFW1 dsn): the bar (at least 80 % of the cases placed and passing, no gate escapes,
 * a median of 6 renders or fewer, and the vision judge's rubric where a judge ran), the top refusal codes, each
 * case's line, and a contact sheet of every placed graphic's last stills (a local HTML page beside its JPEGs) for
 * the owner to look through.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactId, ArtifactStore } from '@taalcut/core';
import type { CaseOutcome } from './run';

export const DESIGN_BAR = { passRate: 0.8, gateEscapes: 0, medianRenders: 6, judgeMean: 3.5 } as const;

export interface JudgedCase {
  /** 1 (wrong or broken) to 5 (what was asked, clean, fits the video). */
  readonly score: number;
  readonly note: string;
}

export interface DesignReport {
  readonly model: string;
  readonly cases: number;
  readonly passed: number;
  readonly passRate: number;
  readonly gateEscapes: number;
  readonly medianRenders: number;
  readonly judgeMean: number | null;
  readonly meetsBar: boolean;
  readonly topRefusals: readonly { readonly code: string; readonly count: number }[];
  readonly results: readonly (CaseOutcome & { readonly judged?: JudgedCase })[];
}

const median = (values: readonly number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export function designReport(
  model: string,
  results: readonly (CaseOutcome & { readonly judged?: JudgedCase })[],
): DesignReport {
  const passed = results.filter((result) => result.pass).length;
  const passRate = results.length ? passed / results.length : 0;
  const gateEscapes = results.filter((result) => result.gateEscape).length;
  const medianRenders = median(results.map((result) => result.renders));
  const judged = results.flatMap((result) => (result.judged ? [result.judged.score] : []));
  const judgeMean = judged.length ? judged.reduce((sum, score) => sum + score, 0) / judged.length : null;
  const counts = new Map<string, number>();
  for (const result of results) for (const code of result.refusals) counts.set(code, (counts.get(code) ?? 0) + 1);
  const topRefusals = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([code, count]) => ({ code, count }));
  const meetsBar =
    passRate >= DESIGN_BAR.passRate &&
    gateEscapes <= DESIGN_BAR.gateEscapes &&
    medianRenders <= DESIGN_BAR.medianRenders &&
    (judgeMean === null || judgeMean >= DESIGN_BAR.judgeMean);
  return {
    model,
    cases: results.length,
    passed,
    passRate,
    gateEscapes,
    medianRenders,
    judgeMean,
    meetsBar,
    topRefusals,
    results,
  };
}

const percent = (value: number) => `${Math.round(value * 100)} %`;

export function designMarkdown(report: DesignReport): string {
  const lines = [
    `# eval:design — ${report.model}`,
    '',
    `- Placed and passing: ${report.passed} of ${report.cases} (${percent(report.passRate)}; bar ${percent(DESIGN_BAR.passRate)})`,
    `- Gate escapes: ${report.gateEscapes} (bar ${DESIGN_BAR.gateEscapes})`,
    `- Median renders: ${report.medianRenders} (bar ≤ ${DESIGN_BAR.medianRenders})`,
    `- Vision judge: ${report.judgeMean === null ? 'not run' : `${report.judgeMean.toFixed(2)} of 5 (bar ${DESIGN_BAR.judgeMean})`}`,
    `- Meets the bar: ${report.meetsBar ? 'yes' : 'no'}`,
    '',
    '## Top refusal codes',
    '',
    ...(report.topRefusals.length
      ? report.topRefusals.map((entry) => `- \`${entry.code}\`: ${entry.count}`)
      : ['- none']),
    '',
    '## Cases',
    '',
    '| case | kind | result | renders | turns | s | judge |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.results.map(
      (result) =>
        `| ${result.id} | ${result.kind} | ${result.pass ? 'pass' : `FAIL: ${result.why ?? ''}`} | ${result.renders} | ${result.turns} | ${(result.ms / 1000).toFixed(1)} | ${result.judged ? `${result.judged.score}: ${result.judged.note}` : '—'} |`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Every placed graphic's last stills as JPEGs, and a local page that shows them by case. */
export async function writeContactSheet(
  report: DesignReport,
  stills: ReadonlyMap<string, ArtifactStore>,
  dir: string,
): Promise<string> {
  const folder = join(dir, 'design-sheet');
  await mkdir(folder, { recursive: true });
  const rows: string[] = [];
  for (const result of report.results) {
    const store = stills.get(result.id);
    const images: string[] = [];
    for (const [index, id] of result.stills.entries()) {
      const stored = store ? await store.get(id as ArtifactId) : null;
      if (!stored?.ok) continue;
      const name = `${result.id}-${index + 1}.jpg`;
      await writeFile(join(folder, name), stored.value.data);
      images.push(`<img src="design-sheet/${name}" alt="${escape(result.id)} still ${index + 1}">`);
    }
    rows.push(
      `<section><h2>${escape(result.id)} <small>${result.pass ? 'pass' : `fail: ${escape(result.why ?? '')}`}</small></h2>` +
        `<p>${escape(result.request)}</p><div class="stills">${images.join('') || '<em>no stills</em>'}</div></section>`,
    );
  }
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Design contact sheet</title>
<style>body{font:14px system-ui;margin:16px;background:#111;color:#eee}section{margin:0 0 24px}h2{font-size:16px;margin:0 0 4px}
small{color:#aaa;font-weight:400}.stills{display:flex;gap:8px;flex-wrap:wrap}img{height:320px;border:1px solid #333}</style>
</head><body><h1>${escape(report.model)}: ${report.passed} of ${report.cases}</h1>${rows.join('\n')}</body></html>\n`;
  const path = join(dir, 'design-contact-sheet.html');
  await writeFile(path, page);
  return path;
}

export async function writeDesignReport(report: DesignReport, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'design.json'), `${JSON.stringify(report, null, 1)}\n`);
  await writeFile(join(dir, 'design.md'), designMarkdown(report));
}
