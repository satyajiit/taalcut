// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The blind A/B sheet for LRN1-CTX (P2-T5's rating sheet, two intents a slot). Each row shows one slot of a
 * reference: its time, its contact-sheet tile, the reference's on-screen text and speech over it, and the two
 * arms' intents as "1" and "2" in an order drawn from the seed. Nothing on the sheet says which is which; the
 * key does, and only `ab-score` reads it. The rater fills `usable1`, `usable2` (yes or no) and `better` (1, 2 or
 * same).
 */
import { z } from 'zod';
import { ARMS, firstArm, type Arm, type ArmPairing } from './ab-arms';

export const AB_COLUMNS = [
  'reel',
  'slot',
  'startFrame',
  'endFrame',
  'tile',
  'onScreen',
  'speech',
  'intent1',
  'shotType1',
  'motion1',
  'intent2',
  'shotType2',
  'motion2',
  'usable1',
  'usable2',
  'better',
] as const;

export const abKeySchema = z
  .object({
    suite: z.literal('intents-ab'),
    seed: z.string().min(1),
    synthetic: z.boolean(),
    /** Which arm each row shows as "1". */
    rows: z.array(
      z.object({ reel: z.string().min(1), slot: z.int().nonnegative(), first: z.enum(ARMS) }).strict(),
    ),
    unpaired: z.array(
      z.object({ reel: z.string(), with: z.array(z.int()), without: z.array(z.int()) }).strict(),
    ),
  })
  .strict();
export type AbKey = z.infer<typeof abKeySchema>;

function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const other = (arm: Arm): Arm => (arm === 'with' ? 'without' : 'with');

/** The sheet (CSV) and its key, rows in reel and slot order. */
export function abSheet(pairing: ArmPairing, seed: string, synthetic: boolean): { csv: string; key: AbKey } {
  const lines = [AB_COLUMNS.join(',')];
  const rows: AbKey['rows'] = [];
  for (const row of pairing.rows) {
    const first = firstArm(seed, row.reel, row.slot);
    const one = row.intents[first];
    const two = row.intents[other(first)];
    rows.push({ reel: row.reel, slot: row.slot, first });
    lines.push(
      [
        row.reel,
        String(row.slot),
        String(row.start),
        String(row.end),
        row.tile === null ? '' : String(row.tile),
        row.onScreen,
        row.speech,
        one.text,
        one.shotType ?? '',
        one.motion ?? '',
        two.text,
        two.shotType ?? '',
        two.motion ?? '',
        '',
        '',
        '',
      ]
        .map(cell)
        .join(','),
    );
  }
  return {
    csv: `${lines.join('\n')}\n`,
    key: { suite: 'intents-ab', seed, synthetic, rows, unpaired: pairing.unpaired },
  };
}
