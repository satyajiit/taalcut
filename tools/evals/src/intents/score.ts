// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { type MetricPoint, type SuiteEnvelope } from '../envelope';

/** P2-T5: usable share on the 20-reel sample. */
export const INTENT_BAR = 0.8;

export interface RatedRow {
  reel: string;
  slot: string;
  usable: 'yes' | 'no';
  synthetic: boolean;
}

export interface IntentScore {
  usable: number;
  rows: number;
  share: number;
  pass: boolean;
  synthetic: boolean;
  perReel: { reel: string; usable: number; rows: number; share: number }[];
  envelope: SuiteEnvelope;
}

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells;
}

export function ratedRows(csv: string): RatedRow[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0];
  if (header === undefined) throw new Error('Intent sheet is empty');
  const columns = parseLine(header);
  const reelAt = columns.indexOf('reel');
  const slotAt = columns.indexOf('slot');
  const usableAt = columns.indexOf('usable');
  const syntheticAt = columns.indexOf('synthetic');
  if (reelAt < 0 || slotAt < 0 || usableAt < 0) {
    throw new Error('Intent sheet needs reel, slot and usable columns');
  }
  return lines.slice(1).map((line, index) => {
    const cells = parseLine(line);
    const usable = cells[usableAt]?.trim() ?? '';
    if (usable !== 'yes' && usable !== 'no') {
      throw new Error(`Row ${index + 2} (${cells[reelAt] ?? '?'}) has usable "${usable}". Fill yes or no.`);
    }
    return {
      reel: cells[reelAt] ?? '',
      slot: cells[slotAt] ?? '',
      usable,
      synthetic: syntheticAt >= 0 && cells[syntheticAt] === 'true',
    };
  });
}

export function scoreIntentSheet(csv: string): IntentScore {
  const rows = ratedRows(csv);
  if (rows.length === 0) throw new Error('Intent sheet has no rows');
  const byReel = new Map<string, { usable: number; rows: number }>();
  let usable = 0;
  for (const row of rows) {
    if (row.usable === 'yes') usable += 1;
    const bucket = byReel.get(row.reel) ?? { usable: 0, rows: 0 };
    bucket.rows += 1;
    if (row.usable === 'yes') bucket.usable += 1;
    byReel.set(row.reel, bucket);
  }
  const share = usable / rows.length;
  const synthetic = rows.some((row) => row.synthetic);
  const pass = share >= INTENT_BAR;
  const metrics: MetricPoint[] = [{ name: 'usableShare', value: share, better: 'higher' }];
  return {
    usable,
    rows: rows.length,
    share,
    pass,
    synthetic,
    perReel: [...byReel.entries()].map(([reel, bucket]) => ({
      reel,
      usable: bucket.usable,
      rows: bucket.rows,
      share: bucket.usable / bucket.rows,
    })),
    envelope: {
      suite: 'intents',
      synthetic,
      claimed: !synthetic,
      gate: { id: 'T5', pass, detail: `${usable}/${rows.length} slots usable (need ${INTENT_BAR})` },
      metrics,
    },
  };
}

export function scoreIntentFile(path: string): IntentScore {
  return scoreIntentSheet(readFileSync(path, 'utf8'));
}
