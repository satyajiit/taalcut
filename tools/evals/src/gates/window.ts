// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcMidnight(date: string, end: boolean): number {
  const match = DATE.exec(date);
  if (match === null) throw new Error(`Bad date ${date}: expected YYYY-MM-DD`);
  const iso = end ? `${date}T23:59:59.999Z` : `${date}T00:00:00.000Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`Bad date ${date}`);
  // Date.parse overflows 2027-02-31 into March. The calendar day must round-trip.
  if (new Date(ms).toISOString().slice(0, 10) !== date) throw new Error(`Bad date ${date}`);
  return ms;
}

/** Inclusive UTC dates. `to` runs through 23:59:59.999Z. */
export function dateWindow(from: string, to: string): { fromMs: number; toMs: number } {
  const fromMs = utcMidnight(from, false);
  const toMs = utcMidnight(to, true);
  if (fromMs > toMs) throw new Error(`--from ${from} is after --to ${to}`);
  return { fromMs, toMs };
}

export function inWindow(at: number, fromMs: number, toMs: number): boolean {
  return at >= fromMs && at <= toMs;
}
