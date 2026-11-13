// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The LRN1-CTX intent A/B on the casting suite (P2-Q2): the same casting cases cast twice, once with the intents
 * the Analyst wrote without slot context and once with them. A case's template keeps its slots (the labels'
 * slot indexes are its); only each slot's intent is swapped for the paired slot's intent from the arm's template
 * of the same reel (`<reel>.json`, the case's template file name). Everything else (library, weights, seed)
 * is the same, so a change in pick acceptance is the intents'.
 */
import { basename, join, relative } from 'node:path';
import { templateSchema, type Template } from '@taalcut/core';
import type { CastingSystem, CastingWeights } from '../adapters/types';
import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import { writeJson } from '../files';
import { predictCasting, scoreCasting } from '../casting/run';
import type { CastingReport } from '../casting/report';
import type { CastingCase } from '../casting/schema';
import { ARMS, armsAreSynthetic, pairSlots, readTemplateFile, spansOf, type Arm } from './ab-arms';

export interface AbCastingInput {
  readonly cases: readonly CastingCase[];
  /** Each casting library's folder by name: a case's template file is relative to it. */
  readonly libraries: Readonly<Record<string, string>>;
  readonly arms: Readonly<Record<Arm, ReadonlyMap<string, Template>>>;
  /** Where the arms' case templates and predictions are written. */
  readonly outDir: string;
}

export interface ArmCases {
  readonly cases: Readonly<Record<Arm, CastingCase[]>>;
  readonly skipped: { caseId: string; reason: string }[];
}

/** `template` with each slot's intent taken from the slot of `from` it pairs with; null when a slot has none. */
export function withIntentsOf(template: Template, from: Template): Template | null {
  const source = new Map(pairSlots(spansOf(template), spansOf(from)).pairs);
  const slots: Template['slots'] = [];
  for (const [index, slot] of template.slots.entries()) {
    const other = source.get(index);
    const intent = other === undefined ? undefined : from.slots[other]?.intent;
    if (!intent) return null;
    slots.push({ ...slot, intent });
  }
  return templateSchema.parse({ ...template, slots });
}

/** Each case twice, its template's intents swapped for each arm's; written under `outDir/templates/<arm>/`. */
export function armCases(input: AbCastingInput): ArmCases {
  const cases: Record<Arm, CastingCase[]> = { with: [], without: [] };
  const skipped: ArmCases['skipped'] = [];
  for (const item of input.cases) {
    if (!('file' in item.template)) {
      skipped.push({ caseId: item.caseId, reason: 'a story-order case (brief): no Analyst intents' });
      continue;
    }
    const libraryDir = input.libraries[item.library];
    if (libraryDir === undefined) throw new Error(`No folder for casting library ${item.library}`);
    const reel = basename(item.template.file, '.json');
    const lacking = ARMS.find((arm) => !input.arms[arm].has(reel));
    if (lacking) {
      skipped.push({ caseId: item.caseId, reason: `no ${reel}.json in the ${lacking} arm` });
      continue;
    }
    const own = readTemplateFile(join(libraryDir, item.template.file));
    const swapped = ARMS.map((arm) => {
      const from = input.arms[arm].get(reel);
      return { arm, template: from ? withIntentsOf(own, from) : null };
    });
    const gap = swapped.find((side) => side.template === null);
    if (gap) {
      skipped.push({ caseId: item.caseId, reason: `the ${gap.arm} arm doesn't cover every slot` });
      continue;
    }
    for (const { arm, template } of swapped) {
      const path = join(input.outDir, 'templates', arm, item.library, `${reel}.json`);
      writeJson(path, template);
      cases[arm].push({ ...item, template: { file: relative(libraryDir, path) } });
    }
  }
  return { cases, skipped };
}

export interface AbCastingReport {
  readonly reports: Readonly<Record<Arm, CastingReport>>;
  readonly skipped: ArmCases['skipped'];
  readonly envelope: SuiteEnvelope;
}

/** Casts and scores both arms with the same system and weights; predictions go to `outDir/predictions/<arm>/`. */
export async function runAbCasting(
  system: CastingSystem,
  input: AbCastingInput,
  weights: CastingWeights,
): Promise<AbCastingReport> {
  const { cases, skipped } = armCases(input);
  if (cases.with.length === 0)
    throw new Error('No casting case has a template both arms made: nothing to compare');
  const scored = async (arm: Arm) => {
    const predictions = await predictCasting(
      system,
      cases[arm],
      weights,
      join(input.outDir, 'predictions', arm),
    );
    return scoreCasting(cases[arm], new Map(predictions.map((item) => [item.caseId, item])));
  };
  const reports: Record<Arm, CastingReport> = {
    with: await scored('with'),
    without: await scored('without'),
  };
  const pick = (arm: Arm) => reports[arm].scores.pickAcceptance;
  const synthetic =
    cases.with.some((item) => item.synthetic) || reports.with.synthetic || armsAreSynthetic(input.arms);
  return {
    reports,
    skipped,
    envelope: {
      suite: 'intents-ab-casting',
      synthetic,
      claimed: !synthetic,
      gate: {
        id: 'LRN1-CTX',
        pass:
          pick('with') >= pick('without') &&
          reports.with.scores.orderAcceptance >= reports.without.scores.orderAcceptance,
        detail: `pick acceptance ${pick('with').toFixed(3)} with context against ${pick('without').toFixed(3)} without`,
      },
      metrics: [
        { name: 'pickAcceptanceWith', value: pick('with'), better: 'higher' },
        { name: 'pickAcceptanceWithout', value: pick('without'), better: 'higher' },
        { name: 'pickAcceptanceGain', value: pick('with') - pick('without'), better: 'higher' },
      ],
    },
  };
}

export function renderAbCastingMarkdown(report: AbCastingReport): string {
  const row = (arm: Arm, label: string) => {
    const scores = report.reports[arm].scores;
    return `| ${label} | ${scores.pickAcceptance.toFixed(3)} | ${scores.orderAcceptance.toFixed(3)} | ${scores.alternatesAcceptance.toFixed(3)} |`;
  };
  return [
    '# Casting with and without context-aware intents (LRN1-CTX)',
    '',
    envelopeBlock(report.envelope),
    '',
    '| Intents | Pick acceptance | Order acceptance | Alternates acceptance |',
    '| --- | --- | --- | --- |',
    row('with', 'with context'),
    row('without', 'without'),
    '',
    ...(report.skipped.length > 0
      ? ['Cases not compared:', ...report.skipped.map((item) => `- ${item.caseId}: ${item.reason}`), '']
      : []),
  ].join('\n');
}
