// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { readJson } from '../files';
import { loadGoldenDir } from '../evaluate';

const predictionSchema = z
  .object({
    reelId: z.string().min(1),
    synthetic: z.boolean(),
    slots: z
      .array(
        z
          .object({
            id: z.string().min(1),
            shotType: z.string().min(1),
            motion: z.string().min(1),
            frameFile: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export interface IntentRow {
  reel: string;
  slot: string;
  startFrame: number;
  endFrame: number;
  frameFile: string;
  intent: string;
  shotType: string;
  motion: string;
  usable: string;
  synthetic: boolean;
}

const COLUMNS = [
  'reel',
  'slot',
  'startFrame',
  'endFrame',
  'frameFile',
  'intent',
  'shotType',
  'motion',
  'usable',
  'synthetic',
] as const;

function cell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function sheetCsv(rows: readonly IntentRow[]): string {
  const lines = [COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.reel,
        row.slot,
        String(row.startFrame),
        String(row.endFrame),
        row.frameFile,
        row.intent,
        row.shotType,
        row.motion,
        row.usable,
        row.synthetic ? 'true' : 'false',
      ]
        .map(cell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** One row per golden slot. `usable` is left empty for the product owner. */
export function intentRows(goldenDir: string, predictionsDir: string): IntentRow[] {
  const reels = loadGoldenDir(goldenDir);
  const rows: IntentRow[] = [];
  for (const reel of reels) {
    const path = `${predictionsDir}/${reel.reelId}.json`;
    const parsed = predictionSchema.safeParse(readJson(path));
    if (!parsed.success) {
      throw new Error(`${path} is not an analyst run for ${reel.reelId}`);
    }
    if (parsed.data.reelId !== reel.reelId) {
      throw new Error(`${path} declares reelId ${parsed.data.reelId}, expected ${reel.reelId}`);
    }
    for (const slot of reel.slots) {
      const predicted = parsed.data.slots.find((item) => item.id === slot.id);
      if (predicted === undefined) throw new Error(`${path} has no analyst slot ${slot.id}`);
      rows.push({
        reel: reel.reelId,
        slot: slot.id,
        startFrame: slot.startFrame,
        endFrame: slot.endFrame,
        frameFile: predicted.frameFile,
        intent: slot.intent,
        shotType: predicted.shotType,
        motion: predicted.motion,
        usable: '',
        synthetic: reel.synthetic || parsed.data.synthetic,
      });
    }
  }
  if (rows.length === 0) throw new Error(`No slots in ${goldenDir}`);
  return rows;
}
