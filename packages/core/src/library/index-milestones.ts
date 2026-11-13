// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Index milestones (round IX, design C): the two finish lines of indexing an
 * asset. 'searchable': every stage marked searchable that applies to the
 * asset is done or skipped, so search finds it by what it shows, what is
 * said and the text on screen. 'complete': every stage is, including the
 * proxy, filmstrip, waveform, beats, descriptions and duplicate groups. The
 * library computes both from its stage rows and stores `searchableAt`; this
 * file holds the vocabulary, the stage check and the event payload. See
 * packages/core/SPEC.md, "Index milestones".
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';

export const INDEX_MILESTONES = ['searchable', 'complete'] as const;
export const indexMilestoneSchema = z.enum(INDEX_MILESTONES);
export type IndexMilestone = z.output<typeof indexMilestoneSchema>;

/** A stage that names no milestone counts toward 'complete' only. */
export const DEFAULT_INDEX_MILESTONE: IndexMilestone = 'complete';

/** The milestone a stage counts toward, its default filled in. */
export function indexStageMilestone(stage: { readonly milestone?: IndexMilestone }): IndexMilestone {
  return stage.milestone ?? DEFAULT_INDEX_MILESTONE;
}

/**
 * Throws when a searchable stage needs a stage that counts toward 'complete'
 * only: the asset couldn't become searchable before that deeper stage ran,
 * at its lower priority. Needs on stages outside `stages` are not checked.
 * A bug in the stage list, like defineIndexStage's checks.
 */
export function checkIndexStageMilestones(
  stages: readonly {
    readonly stage: string;
    readonly needs: readonly string[];
    readonly milestone?: IndexMilestone;
  }[],
): void {
  const byName = new Map(stages.map((stage) => [stage.stage, stage]));
  for (const stage of stages) {
    if (indexStageMilestone(stage) !== 'searchable') continue;
    const late = stage.needs.find((need) => {
      const needed = byName.get(need);
      return needed !== undefined && indexStageMilestone(needed) !== 'searchable';
    });
    if (late !== undefined)
      throw new Error(
        `Searchable index stage '${stage.stage}' needs '${late}', which counts toward complete only.`,
      );
  }
}

/**
 * The `library.indexMilestone` event: these assets just reached a
 * milestone. Sent once per asset per milestone, and again after a re-index
 * or a stage-version bump cleared it and the asset reached it again; not
 * when it is cleared (that is `library.changed` on the asset). At most 1000
 * ids per event; more go in further events.
 */
export const indexMilestoneEventSchema = z.object({
  milestone: indexMilestoneSchema,
  assetIds: z.array(idSchema<'Asset'>()).min(1).max(1000),
});
export type IndexMilestoneEvent = z.output<typeof indexMilestoneEventSchema>;
