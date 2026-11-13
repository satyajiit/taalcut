// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Scoring the rated A/B sheet (LRN1-CTX): the key says which intent on each row came from which arm. Reported per
 * arm, overall and per reel: the usable share (P2-T5's metric, bar 0.8) and the rater's preference, with a
 * two-sided sign test over the rows where one intent was better. The round's "Done when" is that the
 * with-context arm rates higher on the same reels.
 */
import { parseCsv } from '../csv';
import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import { INTENT_BAR } from './score';
import type { Arm } from './ab-arms';
import type { AbKey } from './ab-sheet';

export interface AbRow {
  readonly reel: string;
  readonly slot: number;
  readonly usable: Readonly<Record<Arm, boolean>>;
  /** Which arm the rater found better, or null for "same". */
  readonly better: Arm | null;
}

export interface ArmTally {
  readonly usable: number;
  readonly rows: number;
  readonly share: number;
}

export interface AbScore {
  readonly rows: number;
  readonly with: ArmTally;
  readonly without: ArmTally;
  /** Rows where the with-context intent was better, worse, or neither. */
  readonly preference: { readonly wins: number; readonly losses: number; readonly ties: number };
  /** Two-sided sign test on wins against losses (ties left out); 1 with no untied row. */
  readonly signTestP: number;
  readonly perReel: { reel: string; with: ArmTally; without: ArmTally }[];
  readonly envelope: SuiteEnvelope;
}

const yesNo = (value: string, where: string): boolean => {
  const answer = value.trim().toLowerCase();
  if (answer === 'yes') return true;
  if (answer === 'no') return false;
  throw new Error(`${where} is "${value}": fill yes or no`);
};

/** The rated sheet's rows, unblinded with the key. Every row of the key must be rated, and no other row. */
export function unblind(csv: string, key: AbKey): AbRow[] {
  const [header, ...lines] = parseCsv(csv).filter((cells) =>
    cells.some((cellText) => cellText.trim() !== ''),
  );
  if (!header) throw new Error('The A/B sheet is empty');
  const column = (name: string) => {
    const at = header.indexOf(name);
    if (at < 0) throw new Error(`The A/B sheet has no ${name} column`);
    return at;
  };
  const at = {
    reel: column('reel'),
    slot: column('slot'),
    usable1: column('usable1'),
    usable2: column('usable2'),
    better: column('better'),
  };
  const firstOf = new Map(key.rows.map((row) => [`${row.reel}#${row.slot}`, row.first]));
  const seen = new Set<string>();
  const rows = lines.map((cells, index) => {
    const reel = cells[at.reel] ?? '';
    const slot = Number(cells[at.slot]);
    const id = `${reel}#${slot}`;
    const first = firstOf.get(id);
    const where = `Row ${index + 2} (${reel}, slot ${cells[at.slot] ?? '?'})`;
    if (!first) throw new Error(`${where} is not in the key: use the key written with this sheet`);
    if (seen.has(id)) throw new Error(`${where} appears twice`);
    seen.add(id);
    const second: Arm = first === 'with' ? 'without' : 'with';
    const one = yesNo(cells[at.usable1] ?? '', `${where} usable1`);
    const two = yesNo(cells[at.usable2] ?? '', `${where} usable2`);
    const better = (cells[at.better] ?? '').trim().toLowerCase();
    if (better !== '1' && better !== '2' && better !== 'same')
      throw new Error(`${where} better is "${cells[at.better] ?? ''}": fill 1, 2 or same`);
    const usable = first === 'with' ? { with: one, without: two } : { with: two, without: one };
    return { reel, slot, usable, better: better === 'same' ? null : better === '1' ? first : second };
  });
  const missing = key.rows.filter((row) => !seen.has(`${row.reel}#${row.slot}`));
  if (missing.length > 0)
    throw new Error(
      `Rows of the key not rated: ${missing.length}, e.g. ${missing[0]?.reel} slot ${missing[0]?.slot}`,
    );
  return rows;
}

/** P(at least as lopsided as wins:losses) under a fair coin, both tails. */
export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  // Σ C(n, i) / 2^n for i ≤ k, term by term, so large n doesn't overflow.
  let term = 2 ** -n;
  let tail = term;
  for (let i = 1; i <= k; i += 1) {
    term *= (n - i + 1) / i;
    tail += term;
  }
  return Math.min(1, 2 * tail);
}

function tally(rows: readonly AbRow[], arm: Arm): ArmTally {
  const usable = rows.filter((row) => row.usable[arm]).length;
  return { usable, rows: rows.length, share: rows.length === 0 ? 0 : usable / rows.length };
}

export function scoreAb(rows: readonly AbRow[], key: AbKey): AbScore {
  if (rows.length === 0) throw new Error('The A/B sheet has no rows');
  const withArm = tally(rows, 'with');
  const withoutArm = tally(rows, 'without');
  const wins = rows.filter((row) => row.better === 'with').length;
  const losses = rows.filter((row) => row.better === 'without').length;
  const signTestP = signTest(wins, losses);
  const reels = [...new Set(rows.map((row) => row.reel))].sort();
  const pass = withArm.share > withoutArm.share && wins > losses;
  return {
    rows: rows.length,
    with: withArm,
    without: withoutArm,
    preference: { wins, losses, ties: rows.length - wins - losses },
    signTestP,
    perReel: reels.map((reel) => {
      const own = rows.filter((row) => row.reel === reel);
      return { reel, with: tally(own, 'with'), without: tally(own, 'without') };
    }),
    envelope: {
      suite: 'intents-ab',
      synthetic: key.synthetic,
      claimed: !key.synthetic,
      gate: {
        id: 'LRN1-CTX',
        pass,
        detail:
          `usable with context ${withArm.share.toFixed(3)} against ${withoutArm.share.toFixed(3)} without ` +
          `(P2-T5 bar ${INTENT_BAR}); with context better on ${wins}, worse on ${losses}, same on ` +
          `${rows.length - wins - losses} (sign test p ${signTestP.toFixed(3)})`,
      },
      metrics: [
        { name: 'usableShareWith', value: withArm.share, better: 'higher' },
        { name: 'usableShareWithout', value: withoutArm.share, better: 'higher' },
        { name: 'usableShareGain', value: withArm.share - withoutArm.share, better: 'higher' },
        { name: 'preferredWith', value: wins / rows.length, better: 'higher' },
      ],
    },
  };
}

export function renderAbMarkdown(score: AbScore, key: AbKey): string {
  const share = (value: ArmTally) => `${value.usable}/${value.rows} (${value.share.toFixed(3)})`;
  const unpaired = key.unpaired.map(
    (item) =>
      `- ${item.reel}: slots ${item.with.join(', ') || 'none'} with, ${item.without.join(', ') || 'none'} without`,
  );
  return [
    '# Intents with and without slot context (LRN1-CTX)',
    '',
    envelopeBlock(score.envelope),
    '',
    `Rows: ${score.rows}. Seed: ${key.seed}.`,
    '',
    '| Arm | Usable | Bar |',
    '| --- | --- | --- |',
    `| with context | ${share(score.with)} | ${score.with.share >= INTENT_BAR ? 'met' : 'not met'} |`,
    `| without | ${share(score.without)} | ${score.without.share >= INTENT_BAR ? 'met' : 'not met'} |`,
    '',
    `Better with context: ${score.preference.wins}; better without: ${score.preference.losses}; same: ` +
      `${score.preference.ties}. Two-sided sign test p = ${score.signTestP.toFixed(4)}.`,
    '',
    '| Reel | Usable with | Usable without |',
    '| --- | --- | --- |',
    ...score.perReel.map((reel) => `| ${reel.reel} | ${share(reel.with)} | ${share(reel.without)} |`),
    '',
    ...(unpaired.length > 0
      ? ['Slots one arm has and the other does not cover (not rated):', ...unpaired, '']
      : []),
  ].join('\n');
}
