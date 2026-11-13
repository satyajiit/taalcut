// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { RouterFamilyCount, RouterPrediction } from './schema';

/** Point estimate, not the Wilson bound. Same numbers as `ROUTER_GATE`. */
export const ROUTER_BARS = { agreement: 0.9, tokenDrop: 0.3, minTasks: 200 } as const;

export interface RouterCaseScore {
  readonly caseId: string;
  readonly n: number;
  readonly matches: number;
  readonly agreement: number;
  readonly full: number;
  readonly routed: number;
  readonly tokenDrop: number;
  readonly tokensMeasured: boolean;
  readonly equalSuccess: number;
  readonly families: readonly RouterFamilyCount[];
  readonly liveFamilies: readonly string[];
}

/** `matches/n >= 0.90`. 180/200 passes; 179/200 fails. Integer compare, so 0.90 is not a short float. */
export function agreementMeets(matches: number, n: number): boolean {
  return n > 0 && matches * 100 >= n * 90;
}

/** `1 - on/off >= 0.30`, i.e. on-tokens are at most 70% of off. Off 100, on 70 passes; 71 fails. */
export function tokenDropMeets(full: number, routed: number): boolean {
  if (full <= 0) return false;
  return routed * 10 <= full * 7;
}

export function tokenDropOf(full: number, routed: number): number {
  if (full <= 0) return 0;
  return 1 - routed / full;
}

/** Families at the agreement bar, and only when the whole rule passes. */
export function liveFamiliesOf(families: readonly RouterFamilyCount[], pass: boolean): string[] {
  if (!pass) return [];
  return families
    .filter((row) => agreementMeets(row.matches, row.n))
    .map((row) => row.family)
    .sort();
}

export function routerCasePasses(row: RouterCaseScore): boolean {
  return (
    row.n >= ROUTER_BARS.minTasks &&
    agreementMeets(row.matches, row.n) &&
    row.tokensMeasured &&
    tokenDropMeets(row.full, row.routed) &&
    row.equalSuccess === 1
  );
}

export function scoreRouterCase(row: RouterPrediction): RouterCaseScore {
  if (row.matches > row.n) throw new Error(`${row.caseId}: matches ${row.matches} exceed n ${row.n}`);
  for (const family of row.families) {
    if (family.matches > family.n) throw new Error(`${row.caseId}: ${family.family} matches exceed n`);
  }
  const tokens = row.tokens;
  const full = tokens?.full ?? 0;
  const routed = tokens?.routed ?? 0;
  const equalSuccess = row.measured && row.flips === 0 ? 1 : 0;
  const drafted: RouterCaseScore = {
    caseId: row.caseId,
    n: row.n,
    matches: row.matches,
    agreement: row.n === 0 ? 0 : row.matches / row.n,
    full,
    routed,
    tokenDrop: tokens === null ? 0 : tokenDropOf(full, routed),
    tokensMeasured: tokens !== null,
    equalSuccess,
    families: [...row.families].sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0)),
    liveFamilies: [],
  };
  return { ...drafted, liveFamilies: liveFamiliesOf(drafted.families, routerCasePasses(drafted)) };
}
