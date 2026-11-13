// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The study's report: scores per library and candidate (overall, per language, per kind), bench checks, ranks. */
import { PROBE_KINDS } from './schema';
import type { GroupScore, StudyReport } from './run';

const LANGUAGES = ['en', 'hi', 'es', 'pt-BR'] as const;
const fixed = (value: number) => value.toFixed(3);

function scoreOf(
  report: StudyReport,
  library: string,
  candidate: string,
  group: string,
): GroupScore | undefined {
  return report.scores.find((s) => s.library === library && s.candidate === candidate && s.group === group);
}

function summary(report: StudyReport, library: string): string[] {
  const header = [
    'candidate',
    'n',
    'hit@1',
    'hit@5',
    'MRR',
    ...LANGUAGES.map((l) => `${l} hit@1 / @5 / MRR`),
    ...PROBE_KINDS.map((k) => `${k} @1 / @5`),
  ];
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const candidate of report.candidates) {
    const all = scoreOf(report, library, candidate.id, 'all');
    if (!all) continue;
    const cell = (group: string, full: boolean) => {
      const s = scoreOf(report, library, candidate.id, group);
      if (!s || s.probes === 0) return '–';
      return full
        ? `${fixed(s.hitAt1)} / ${fixed(s.hitAt5)} / ${fixed(s.mrr)} (${s.probes})`
        : `${fixed(s.hitAt1)} / ${fixed(s.hitAt5)} (${s.probes})`;
    };
    lines.push(
      `| ${[
        candidate.id,
        String(all.probes),
        fixed(all.hitAt1),
        fixed(all.hitAt5),
        fixed(all.mrr),
        ...LANGUAGES.map((l) => cell(l, true)),
        ...PROBE_KINDS.map((k) => cell(k, false)),
      ].join(' | ')} |`,
    );
  }
  return lines;
}

function benchTable(report: StudyReport): string[] {
  if (report.bench.length === 0) return [];
  const lines = [
    '## Bench search checks (the indexing e2e on ix-v1)',
    '',
    '| library | candidate | passed | failures |',
    '| --- | --- | --- | --- |',
  ];
  const keys = [...new Set(report.bench.map((b) => `${b.library}\u0000${b.candidate}`))];
  for (const key of keys) {
    const [library, candidate] = key.split('\u0000');
    const checks = report.bench.filter((b) => b.library === library && b.candidate === candidate);
    const failed = checks.filter((b) => !b.pass).map((b) => `${b.check}: got ${b.got}`);
    lines.push(
      `| ${library} | ${candidate} | ${checks.length - failed.length}/${checks.length} | ${failed.join('; ') || '–'} |`,
    );
  }
  return [...lines, ''];
}

function rankMatrix(report: StudyReport, library: string): string[] {
  const candidates = report.candidates.map((c) => c.id);
  const lines = [
    `| probe | ${candidates.join(' | ')} |`,
    `| --- | ${candidates.map(() => '---').join(' | ')} |`,
  ];
  const probes = report.probes.filter((p) =>
    report.results.some((r) => r.library === library && r.probe === p.id),
  );
  for (const probe of probes) {
    const ranks = candidates.map((candidate) => {
      const rank = report.results.find(
        (r) => r.library === library && r.candidate === candidate && r.probe === probe.id,
      )?.rank;
      return rank === null || rank === undefined ? '–' : String(rank);
    });
    lines.push(`| ${probe.id} | ${ranks.join(' | ')} |`);
  }
  return lines;
}

export function studyMarkdown(report: StudyReport): string {
  const lines = [
    '# Search ranking study (IX2-U1)',
    '',
    `Query vectors: ${report.vectors.space} on ${report.vectors.device}. Each probe asks for 20 hits; MRR counts a probe with no relevant hit as 0.`,
    '',
    '## Candidates',
    '',
    ...report.candidates.map((c) => `- \`${c.id}\` (${c.version}): ${c.about}`),
    '',
  ];
  for (const library of report.libraries) {
    lines.push(
      `## ${library.label} (${library.set})`,
      '',
      `\`${library.path}\``,
      '',
      ...summary(report, library.label),
      '',
    );
  }
  lines.push(...benchTable(report));
  for (const library of report.libraries) {
    lines.push(
      `## Ranks: ${library.label}`,
      '',
      'Rank of the first relevant hit (– when none in 20).',
      '',
      ...rankMatrix(report, library.label),
      '',
    );
  }
  return lines.join('\n');
}
