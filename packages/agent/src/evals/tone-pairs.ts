// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Swapped-order pairwise scoring (SPEC section 22; Zheng et al., arXiv:2306.05685): every pair of providers is
 * judged on the same prompt twice, once in each order. When the verdict changes with the order the pair is
 * position-inconsistent: it is dropped from the win rate and counted in the inconsistency rate. Win rate is
 * wins / (wins + losses) over the consistent pairs; ties count for neither.
 */
import type { ToneRecording } from './tone-types';

export interface PairResult {
  /** The two providers, in alphabetical order. */
  readonly a: string;
  readonly b: string;
  readonly aWins: number;
  readonly bWins: number;
  readonly ties: number;
  /** Prompts whose verdict flipped with the order. */
  readonly inconsistent: number;
  /** Prompts judged in only one order: neither consistent nor counted. */
  readonly oneOrder: number;
  /** a's wins / (wins + losses) on consistent pairs; null with no decided pair. */
  readonly winRateA: number | null;
}

export interface PairSummary {
  readonly pairs: readonly PairResult[];
  /** Inconsistent / (consistent + inconsistent) over every pair judged in both orders; 0 when none were. */
  readonly inconsistencyRate: number;
  /** Prompt-and-pair verdicts judged in both orders. */
  readonly judged: number;
}

type Verdict = string | 'tie';
type Tally = { -readonly [K in Exclude<keyof PairResult, 'winRateA'>]: PairResult[K] };

/** The winning provider of one judged order, or 'tie'. */
function verdictOf(entry: ToneRecording['pairs'][number]): Verdict {
  if (entry.winner === 'tie') return 'tie';
  return entry.winner === 'first' ? entry.first : entry.second;
}

export function pairSummary(recording: Pick<ToneRecording, 'pairs'>): PairSummary {
  // promptId|a|b → the verdicts with a first, and with b first.
  const orders = new Map<string, { abFirst?: Verdict; baFirst?: Verdict }>();
  for (const entry of recording.pairs) {
    const [a, b] = [entry.first, entry.second].sort();
    const key = `${entry.promptId}|${a}|${b}`;
    const known = orders.get(key) ?? {};
    if (entry.first === a) known.abFirst = verdictOf(entry);
    else known.baFirst = verdictOf(entry);
    orders.set(key, known);
  }
  const tallies = new Map<string, Tally>();
  for (const [key, verdicts] of orders) {
    const [, a = '', b = ''] = key.split('|');
    const pairKey = `${a}|${b}`;
    const tally = tallies.get(pairKey) ?? { a, b, aWins: 0, bWins: 0, ties: 0, inconsistent: 0, oneOrder: 0 };
    tallies.set(pairKey, tally);
    if (verdicts.abFirst === undefined || verdicts.baFirst === undefined) tally.oneOrder += 1;
    else if (verdicts.abFirst !== verdicts.baFirst) tally.inconsistent += 1;
    else if (verdicts.abFirst === 'tie') tally.ties += 1;
    else if (verdicts.abFirst === a) tally.aWins += 1;
    else tally.bWins += 1;
  }
  const pairs = [...tallies.values()]
    .sort((x, y) => `${x.a}|${x.b}`.localeCompare(`${y.a}|${y.b}`))
    .map((t) => ({ ...t, winRateA: t.aWins + t.bWins > 0 ? t.aWins / (t.aWins + t.bWins) : null }));
  const inconsistent = pairs.reduce((sum, p) => sum + p.inconsistent, 0);
  const judged = pairs.reduce((sum, p) => sum + p.aWins + p.bWins + p.ties + p.inconsistent, 0);
  return { pairs, inconsistencyRate: judged > 0 ? inconsistent / judged : 0, judged };
}
