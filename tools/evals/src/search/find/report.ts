// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The find eval's report: scores per candidate, then per kind and language, then every query's top hits. */
import type { FindGroupScore, FindReport } from './run';

const n3 = (value: number) => value.toFixed(3);

function scoreRow(label: string, score: FindGroupScore): string {
  return `| ${label} | ${score.queries} | ${n3(score.recallAt10)} | ${n3(score.mrr)} | ${n3(score.hitAt1)} | ${n3(score.hitAt5)} | ${n3(score.rPrecision)} |`;
}

const HEAD = [
  '| | Queries | recall@10 | MRR | hit@1 | hit@5 | R-precision |',
  '| --- | --- | --- | --- | --- | --- | --- |',
];

export function findMarkdown(report: FindReport): string {
  const d = report.descriptions;
  const lines = [
    '# Find eval (LIB1-FIND)',
    '',
    `- Library: ${report.library.clips} clips${report.library.owner ? ', a local owner set included (scored apart)' : ' (Commons only)'}; places: ${report.library.places ? 'yes' : 'none yet'}.`,
    `- Descriptions: ${d.label}${d.prompt ? ` (prompt ${d.prompt}, ${d.model})` : ''}; ${d.described} of ${d.shots} shots described.`,
    ...(d.failed.length > 0
      ? [
          `- Describe failed (left undescribed, as in the app): ${d.failed.map((f) => f.replace(/ \(.*$/s, '')).join('; ')}.`,
        ]
      : []),
    ...(d.replay
      ? [
          `- Replay: ${d.replay.answered} answers; ${d.replay.otherPrompt} under another system prompt, ${d.replay.otherText} with other request text, ${d.replay.otherFrame} for other frame pixels.`,
        ]
      : []),
    `- Skipped: ${report.skipped.length === 0 ? 'none' : report.skipped.map((s) => `${s.query} (${s.why})`).join('; ')}.`,
    '',
    '## Overall (Commons clips)',
    '',
    ...HEAD,
    ...report.candidates.map((c) =>
      scoreRow(
        `${c.id} (${c.version})`,
        report.groups.find((g) => g.candidate === c.id && g.group === 'all')!,
      ),
    ),
    '',
  ];
  const ownerRows = report.candidates.flatMap((c) => {
    const group = report.groups.find((g) => g.candidate === c.id && g.group === 'owner:all');
    return group ? [scoreRow(`${c.id} (${c.version})`, group)] : [];
  });
  if (ownerRows.length > 0)
    lines.push(
      '## The owner set (local)',
      '',
      'Every clip counts, the owner set’s with the Commons ones, over the queries its clips answer.',
      '',
      ...HEAD,
      ...ownerRows,
      '',
    );
  for (const candidate of report.candidates) {
    const own = report.groups.filter(
      (g) => g.candidate === candidate.id && g.group !== 'all' && g.group !== 'owner:all',
    );
    lines.push(
      `## ${candidate.id}`,
      '',
      candidate.about,
      '',
      ...HEAD,
      ...own.map((g) => scoreRow(g.group, g)),
      '',
    );
    lines.push(
      '| Query | Text | Rank | recall@10 | R-precision | With the owner set | First hits |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const result of report.results.filter((r) => r.candidate === candidate.id)) {
      const query = report.queries.find((q) => q.id === result.query)!;
      const wanted = new Set(result.owner?.relevant ?? result.relevant);
      const score = result.score;
      const owner = result.owner
        ? `rank ${result.owner.score.rank ?? '–'}, R ${n3(result.owner.score.rPrecision)}`
        : '';
      const top = result.top
        .slice(0, 4)
        .map(
          (hit) =>
            `${wanted.has(hit.clip) ? '**' : ''}${hit.clip}${wanted.has(hit.clip) ? '**' : ''} (${hit.matchedBy.join('+')})`,
        )
        .join(', ');
      lines.push(
        `| ${query.id} | ${query.text}${query.filters ? ' (filtered)' : ''} | ${score ? (score.rank ?? '–') : ''} | ${score ? n3(score.recallAt10) : ''} | ${score ? n3(score.rPrecision) : ''} | ${owner} | ${top || 'no hits'} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
