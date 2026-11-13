// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What an indexing bench's library embedded (IX3-N2), read back from its jobs: each `vision.embedAsset` job's frames
 * under the ids the stage stored them (`frame:<shotId>:<n>`, best frame first), and each `vision.embedTexts` job's
 * transcript segments and on-screen text tracks under theirs. The bench keeps the library
 * (`~/TaalcutBench/runs/<name>/run-1/index-library.sqlite`), so these are exactly the items of that run.
 */
import { DatabaseSync } from 'node:sqlite';
import { basename } from 'node:path';
import type { NormalisationPlan } from '@taalcut/media';
import { z } from 'zod';

export interface IxAsset {
  readonly file: string;
  readonly path: string;
  readonly plan: NormalisationPlan;
  /** Grid frames in the job's order, and the item id each one's vector is stored under. */
  readonly frames: readonly { readonly frame: number; readonly itemId: string }[];
}

export interface IxText {
  readonly itemId: string;
  readonly kind: string;
  readonly text: string;
}

export interface IxSet {
  readonly assets: readonly IxAsset[];
  readonly texts: readonly IxText[];
}

const embedPayload = z.object({
  path: z.string(),
  plan: z.custom<NormalisationPlan>((value) => typeof value === 'object' && value !== null),
  frames: z.array(z.object({ shotId: z.string(), frames: z.array(z.int().nonnegative()) })),
});
const textsPayload = z.object({
  texts: z.array(z.object({ itemId: z.string(), kind: z.string(), text: z.string() })),
});
const row = z.object({ payload: z.string() });

function payloads(db: DatabaseSync, kind: string): unknown[] {
  return db
    .prepare("SELECT payload FROM jobs WHERE kind = ? AND state = 'succeeded' ORDER BY started_at")
    .all(kind)
    .map((raw) => JSON.parse(row.parse(raw).payload) as unknown);
}

export function readIxSet(library: string): IxSet {
  const db = new DatabaseSync(library, { readOnly: true });
  try {
    const assets = payloads(db, 'vision.embedAsset').map((raw) => {
      const payload = embedPayload.parse(raw);
      return {
        file: basename(payload.path),
        path: payload.path,
        plan: payload.plan,
        frames: payload.frames.flatMap((shot) =>
          shot.frames.map((frame, n) => ({ frame, itemId: `frame:${shot.shotId}:${n}` })),
        ),
      };
    });
    // A later job for the same item replaces the earlier one's vector, as the index does.
    const texts = new Map<string, IxText>();
    for (const raw of payloads(db, 'vision.embedTexts'))
      for (const item of textsPayload.parse(raw).texts) texts.set(item.itemId, item);
    return { assets, texts: [...texts.values()] };
  } finally {
    db.close();
  }
}
