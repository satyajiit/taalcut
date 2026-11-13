// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The language eval's Markdown report: before and after, overall, per length, per language, and the local clips by
 * name. The report is written outside the repo: it may hold local clips' results.
 */
import { decideLanguage, LANGUAGE_DECISION, type LanguageDecisionConfig } from '@taalcut/audio';
import type { EvidenceRow } from './evidence';
import { judgeAll, SCENARIOS, tallies, type Judged, type Outcome, type Scenario, type Tally } from './score';
import { FLEURS_LANGUAGES, type LanguageClip } from './sets';
import { rate, splitOf, type Tuned } from './tune';

const LABEL: Record<Scenario, string> = {
  before: 'Before (LIB0: Whisper tiny, no floor)',
  english: 'After, English only (Whisper with the floor; no identifier)',
  own: "After, the person speaks the clip's language",
  indian: 'After, the person speaks Hindi and English',
};

const cell = (t: Tally) => `${rate(t, 'right')} · ${rate(t, 'unclear')} · ${rate(t, 'wrong')}`;
const crop = (seconds: number) => (seconds === 0 ? 'whole' : `${seconds} s`);
const said = (o: Outcome) => (o.state === 'unclear' ? 'unclear' : o.languages.join(' and '));

function table(
  rows: [string, Record<Scenario, Tally>][],
  scenarios: readonly Scenario[] = SCENARIOS,
): string[] {
  return [
    `| | n | ${scenarios.map((s) => s).join(' | ')} |`,
    `| --- | --- | ${scenarios.map(() => '---').join(' | ')} |`,
    ...rows.map(
      ([name, t]) => `| ${name} | ${t.before.n} | ${scenarios.map((s) => cell(t[s])).join(' | ')} |`,
    ),
  ];
}

function consistency(rows: readonly EvidenceRow[]): string {
  let checked = 0;
  let differ = 0;
  for (const row of rows) {
    if (!row.job || row.silent || row.failed) continue;
    checked += 1;
    const pieces = row.pieces ?? [];
    const again = decideLanguage({
      whisper: row.whisper,
      spoken: [],
      ...(row.pieces ? { pieces: pieces.filter((p) => !p.later), later: pieces.filter((p) => p.later) } : {}),
    });
    if (again.state !== row.job.state || again.languages.join() !== row.job.languages.join()) differ += 1;
  }
  return `The job's own decisions, re-decided from the evidence with no prior: ${checked - differ} of ${checked} the same.`;
}

function owner(judged: readonly Judged[]): string[] {
  const lines = [
    '| Clip | Heard | Before | English only | Speaks its language | Speaks Hindi and English | Whisper | Identifier, first piece |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const j of judged.filter((x) => x.clip.set === 'owner')) {
    const whisper = j.row.whisper
      .slice(0, 3)
      .map((s) => `${s.language} ${s.probability.toFixed(2)}`)
      .join(', ');
    const lid = (j.row.pieces?.[0]?.scores ?? [])
      .slice(0, 3)
      .map((s) => `${s.language} ${s.probability.toFixed(2)}`)
      .join(', ');
    lines.push(
      `| ${j.clip.name} | ${crop(j.row.crop)} | ${said(j.outcomes.before)} | ${said(j.outcomes.english)} | ${said(j.outcomes.own)} | ${said(j.outcomes.indian)} | ${whisper || '–'} | ${lid || '–'} |`,
    );
  }
  return lines; // prettier-ignore
}

export function languageReport(
  rows: readonly EvidenceRow[],
  clips: readonly LanguageClip[],
  options: { readonly config?: LanguageDecisionConfig; readonly tuned?: readonly Tuned[] } = {},
): string {
  const config = options.config ?? LANGUAGE_DECISION;
  const judged = judgeAll(rows, clips, config);
  const split = splitOf(clips);
  const real = (j: Judged) => !j.clip.synthetic && j.clip.set !== 'owner';
  const lines: string[] = ['# LIB1-LANG spoken-language eval', ''];
  lines.push(
    'Each cell is right · unclear · wrong. "Unclear" names no language; a wrong language is the error that matters.',
    '',
  );
  lines.push(`Constants: \`${JSON.stringify(config)}\`.`, '', consistency(rows), '');
  lines.push('## Overall (FLEURS and Hinglish)', '');
  lines.push(...table([
    ['all', tallies(judged, real)],
    ['held-out half', tallies(judged, (j) => real(j) && split.get(j.clip.id) === 'test')],
    ...[2, 4, 0].map((c): [string, Record<Scenario, Tally>] => [crop(c), tallies(judged, (j) => real(j) && j.row.crop === c)]),
  ]), ''); // prettier-ignore
  lines.push('Scenarios:', ...SCENARIOS.map((s) => `- \`${s}\`: ${LABEL[s]}`), '');
  lines.push('## Per language (FLEURS, every length)', '');
  lines.push(...table(Object.entries(FLEURS_LANGUAGES).map(([code, language]): [string, Record<Scenario, Tally>] => [
    `${language} (${code})`, tallies(judged, (j) => j.clip.set === 'fleurs' && j.clip.truth.language === language),
  ])), ''); // prettier-ignore
  lines.push('## Per language at 2 s (FLEURS)', '');
  lines.push(...table(Object.entries(FLEURS_LANGUAGES).map(([code, language]): [string, Record<Scenario, Tally>] => [
    `${language} (${code})`, tallies(judged, (j) => j.clip.set === 'fleurs' && j.row.crop === 2 && j.clip.truth.language === language),
  ])), ''); // prettier-ignore
  lines.push('## Hindi with English', '');
  lines.push(...table([
    ['Hinglish phone calls (right: Hindi, or Hindi and English)', tallies(judged, (j) => j.clip.set === 'hinglish')],
    ['synthetic: a Hindi utterance then an English one (right: Hindi and English); never a gate', tallies(judged, (j) => j.clip.set === 'synthetic')],
  ]), ''); // prettier-ignore
  lines.push('## Local clips (owner-clips.json)', '', ...owner(judged), '');
  const ms = rows.map((row) => row.ms).sort((a, b) => a - b);
  lines.push(`Job time per run (FFmpeg pass, voice scan, Whisper tiny, the identifier): median ${ms[Math.floor(ms.length / 2)] ?? 0} ms, p95 ${ms[Math.floor(ms.length * 0.95)] ?? 0} ms over ${ms.length} runs.`, ''); // prettier-ignore
  if (options.tuned?.length) {
    lines.push('## Tuning (dev half; objective right − 3 × wrong over the three after-scenarios)', '');
    lines.push('| floor | whisperFloor | priorWeight | foreignFloor | englishFloor | dev | held-out |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const t of options.tuned.slice(0, 10)) {
      const c = t.config;
      const cells = [c.floor, c.whisperFloor, c.priorWeight, c.foreignFloor, c.englishFloor, t.dev, t.test];
      lines.push(`| ${cells.join(' | ')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
