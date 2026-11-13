// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Real overrides (LRN1-PREF eval): what a creator's library already holds for the learner. Takes a copy of a library
 * database (the PO's Application Support is read-only: copy it first), copies it again before opening, since
 * opening migrates, and reads every project's history and the app-wide one as the agent's job does: the person's
 * swaps and removals, the pairs they give, and how many of the swaps carry the score parts casting showed.
 *
 * With enough swaps it holds out the newest 30%: the learner fits the older entries, and the held-out swaps say how
 * often the learned weights, against the defaults, value the shot the creator swapped in over the pick it replaced.
 * With fewer it says how many there are. Real data, but no gate: `claimed` stays false.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  PERSON_SOURCES,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  unwrap,
  type AuditEntry,
  type CastingWeights,
} from '@taalcut/core';
import { createRepositories, openDatabase } from '@taalcut/library';
import {
  CASTING_CONFIG,
  foldLog,
  LEARNER_CONFIG,
  LEARNER_LOG_COMMANDS,
  learnCastingWeights,
  pairMargin,
  signalPairs,
  type PreferencePair,
} from '@taalcut/timeline';
import type { SuiteEnvelope } from '../envelope';
import { accuracy, type Accuracy } from './score';

/** Swaps (each one "chosen over the pick it replaced") before a held-out number means anything. */
export const MIN_REAL_SWAPS = 30;
const HOLD_OUT = 0.3;
/** Each history's newest entries, as the agent's job reads them. */
const HISTORY = 10_000;

export interface RealDataReport extends SuiteEnvelope {
  readonly suite: 'casting-prefs-real';
  readonly database: string;
  readonly projects: number;
  readonly entries: {
    readonly swaps: number;
    readonly personSwaps: number;
    /** The person's swaps that carry casting's score parts (`scored`, LRN1-PREF onward). */
    readonly withScore: number;
    readonly removals: number;
    readonly personRemovals: number;
  };
  readonly pairs: { readonly count: number; readonly replaced: number; readonly evidence: number };
  readonly enough: boolean;
  readonly heldOut: null | {
    readonly trainEntries: number;
    readonly heldSwaps: number;
    readonly learned: CastingWeights;
    readonly defaults: Accuracy;
    readonly learnedAccuracy: Accuracy;
  };
}

const PEOPLE: ReadonlySet<string> = new Set(PERSON_SOURCES);

/** The replaced pairs (weight `replaced`): the shot swapped in over the pick it replaced. */
const replacedPairs = (pairs: readonly PreferencePair[]) =>
  pairs.filter((pair) => pair.weight === LEARNER_CONFIG.pairWeight.replaced);

function swapAccuracy(weights: CastingWeights, pairs: readonly PreferencePair[]): Accuracy {
  const one = (pair: PreferencePair) => {
    const margin = pairMargin(weights, pair);
    return margin > 0 ? 1 : margin === 0 ? 0.5 : 0;
  };
  return accuracy(
    pairs.reduce((sum, pair) => sum + one(pair), 0),
    pairs.length,
  );
}

/** Every entry the learner reads, oldest first, from a database already opened on a copy. */
function readLog(path: string): { entries: AuditEntry[]; projects: number } {
  const db = unwrap(openDatabase({ path }));
  try {
    const repositories = createRepositories(db);
    const projects = repositories.projects.list();
    const wanted = new Set(LEARNER_LOG_COMMANDS);
    const entries = [null, ...projects.map((project) => project.id)].flatMap((scope) =>
      unwrap(repositories.auditLog.listByProject(scope, { limit: HISTORY })).filter((entry) =>
        wanted.has(entry.name),
      ),
    );
    entries.sort((a, b) => a.createdAt - b.createdAt);
    return { entries, projects: projects.length };
  } finally {
    db.close();
  }
}

function heldOutOf(entries: readonly AuditEntry[]): RealDataReport['heldOut'] {
  const signals = entries.filter((entry) => signalPairs(entry, LEARNER_CONFIG).length > 0);
  const split = signals[Math.floor(signals.length * (1 - HOLD_OUT))];
  if (!split) return null;
  const train = entries.filter((entry) => entry.createdAt < split.createdAt);
  const held = replacedPairs(
    entries
      .filter((entry) => entry.createdAt >= split.createdAt)
      .flatMap((entry) => signalPairs(entry, LEARNER_CONFIG)),
  );
  const folded = foldLog(train, CASTING_CONFIG, LEARNER_CONFIG);
  const learned = learnCastingWeights({
    start: folded.start,
    defaults: CASTING_CONFIG.weights,
    pairs: folded.pairs,
    tau: CASTING_CONFIG.confidence.tau,
  }).weights;
  return {
    trainEntries: train.length,
    heldSwaps: held.length,
    learned,
    defaults: swapAccuracy(CASTING_CONFIG.weights, held),
    learnedAccuracy: swapAccuracy(learned, held),
  };
}

export function readRealSwaps(database: string): RealDataReport {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-prefs-real-'));
  try {
    const copy = join(dir, basename(database));
    copyFileSync(database, copy);
    for (const suffix of ['-wal', '-shm'])
      if (existsSync(`${database}${suffix}`)) copyFileSync(`${database}${suffix}`, `${copy}${suffix}`);
    const { entries, projects } = readLog(copy);
    const swaps = entries.filter((entry) => entry.name === TIMELINE_COMMANDS.swapClip);
    const removals = entries.filter((entry) => entry.name === TIMELINE_COMMANDS.dropSlot);
    const personSwaps = swaps.filter((entry) => PEOPLE.has(entry.source));
    const withScore = personSwaps.filter((entry) => {
      const payload = timelineCommandPayloads[TIMELINE_COMMANDS.swapClip].safeParse(entry.payload);
      return payload.success && payload.data.scored !== undefined;
    });
    const pairs = entries.flatMap((entry) => signalPairs(entry, LEARNER_CONFIG));
    const replaced = replacedPairs(pairs).length;
    const evidence = pairs.reduce((sum, pair) => sum + pair.weight, 0);
    const enough = replaced >= MIN_REAL_SWAPS && evidence >= LEARNER_CONFIG.minEvidence;
    return {
      suite: 'casting-prefs-real',
      synthetic: false,
      claimed: false,
      metrics: [{ name: 'realSwaps', value: replaced, better: 'higher' }],
      database,
      projects,
      entries: {
        swaps: swaps.length,
        personSwaps: personSwaps.length,
        withScore: withScore.length,
        removals: removals.length,
        personRemovals: removals.filter((entry) => PEOPLE.has(entry.source)).length,
      },
      pairs: { count: pairs.length, replaced, evidence },
      enough,
      heldOut: enough ? heldOutOf(entries) : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function renderRealMarkdown(report: RealDataReport): string {
  const { entries, pairs, heldOut } = report;
  const lines = [
    '# Learned casting preferences: real overrides (LRN1-PREF)',
    '',
    'Synthetic: no. No gate: these numbers are not claimed.',
    '',
    `Database: ${report.database} (a copy, copied again before opening). Projects: ${report.projects}.`,
    `Swaps: ${entries.swaps} (the person's: ${entries.personSwaps}, with casting's score parts: ${entries.withScore}). Removals: ${entries.removals} (the person's: ${entries.personRemovals}).`,
    `Pairs: ${pairs.count} (swapped in over the pick replaced: ${pairs.replaced}), evidence ${pairs.evidence}.`,
    '',
  ];
  if (!heldOut) {
    lines.push(
      `Not enough to hold any out: the held-out number needs ${MIN_REAL_SWAPS} swaps with score parts. Real held-out accuracy waits on the creator's own swaps (human input).`,
      '',
    );
    return lines.join('\n');
  }
  lines.push(
    `Held out: the newest 30% (${heldOut.heldSwaps} swaps); learned on the ${heldOut.trainEntries} entries before them.`,
    `Defaults value the creator's shot over the replaced pick in ${heldOut.defaults.rate.toFixed(3)}; learned in ${heldOut.learnedAccuracy.rate.toFixed(3)}.`,
    '',
  );
  return lines.join('\n');
}
