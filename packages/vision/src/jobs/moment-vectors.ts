// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: the vectors of a shot's moments (`moment:<shotId>:<n>`, kind `moment`): each note embedded as a document in
 * the active space, beside the description's vector, so casting's in-point step can weigh a stretch of a shot against
 * what a slot states with one dot product and no model call. Library search never reads them (its kNN names the
 * kinds it ranks), and a shot's set is replaced whole when it is described again: a new description may have fewer.
 */
import {
  chunk,
  ok,
  SHOT_MOMENT_LIMITS,
  type Embedder,
  type Result,
  type ShotDescription,
  type VectorIndex,
  type VectorItem,
} from '@taalcut/core';
import { keepShotVectors } from './shot-vectors';

export const momentItemId = (shotId: string, n: number): string => `moment:${shotId}:${n}`;

/** Every id a shot's moments may have. */
const everyId = (shotId: string): string[] =>
  Array.from({ length: SHOT_MOMENT_LIMITS.count }, (_, n) => momentItemId(shotId, n));

/**
 * Stores the moments' vectors of the shots just described and drops those of shots that are gone, as
 * `embedDescriptions` does for the sentence: `shots` are the asset's current analysed shots. A shot described now
 * keeps only its new moments; one not described in this run keeps what it has.
 */
export async function embedMoments(
  descriptions: readonly {
    readonly shotId: string;
    readonly description: Pick<ShotDescription, 'moments'>;
  }[],
  input: {
    readonly assetId: string;
    readonly sourceId?: string;
    readonly shots: readonly { shotId: string }[];
  },
  deps: { readonly embedder?: Pick<Embedder, 'embedTexts'>; readonly index?: VectorIndex },
  signal: AbortSignal,
): Promise<Result<void>> {
  const { embedder, index } = deps;
  if (!index) return ok(undefined);
  const metadata = { assetId: input.assetId, sourceId: input.sourceId ?? null, kind: 'moment' as const };
  const notes = descriptions.flatMap((d) =>
    (d.description.moments ?? []).map((moment, n) => ({ id: momentItemId(d.shotId, n), note: moment.note })),
  );
  const items: VectorItem[] = [];
  if (embedder)
    for (const batch of chunk(notes, 64)) {
      const vectors = await embedder.embedTexts(
        batch.map((entry) => entry.note),
        { purpose: 'document', signal },
      );
      if (!vectors.ok) return vectors;
      batch.forEach((entry, i) => {
        const vector = vectors.value[i];
        if (vector) items.push({ id: entry.id, vector, metadata });
      });
    }
  // Without an embedder nothing was described here either: every current shot keeps its vectors.
  const described = new Set(embedder ? descriptions.map((d) => d.shotId) : []);
  const kept = keepShotVectors(index, {
    assetId: input.assetId,
    sourceId: metadata.sourceId,
    kind: 'moment',
    current: input.shots.flatMap((shot) => (described.has(shot.shotId) ? [] : everyId(shot.shotId))),
    items,
  });
  return kept.ok ? ok(undefined) : kept;
}
