// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Librarian's check that a re-cast kept the user's choices (agent SPEC 12
 * and 13: the agent never reverts a user's change). The earlier timeline of
 * the same template and variant, the newest the project has outside the
 * handoff, is what the user last saw; every slot there the user picked (a
 * swap or move, cast note `userPick`) or locked must show the same shot in
 * the handoff, unless the slot itself is gone from the new template version.
 */
import { ok, type AsyncResult, type ProjectId, type Timeline } from '@taalcut/core';
import { shownBySlot, userChoices } from '../model/slot-shots';
import type { TimelineService } from '../service/service';

export interface DroppedPick {
  readonly slotId: string;
  /** The earlier timeline the user made the choice in. */
  readonly timelineId: string;
  /** The shot (or `asset:<id>` for a photo) the user chose. */
  readonly key: string;
}

export async function droppedUserPicks(
  service: Pick<TimelineService, 'read' | 'listByProject'>,
  projectId: ProjectId,
  handed: readonly Timeline[],
): AsyncResult<DroppedPick[]> {
  const listed = await service.listByProject(projectId);
  if (!listed.ok) return listed;
  const handedIds = new Set<string>(handed.map((timeline) => timeline.id));
  const dropped: DroppedPick[] = [];
  for (const [index, timeline] of handed.entries()) {
    const variant = timeline.cast?.variantIndex ?? null;
    const earlier = listed.value
      .filter(
        (summary) =>
          !handedIds.has(summary.id) &&
          summary.template?.id === timeline.template?.id &&
          summary.template !== null &&
          (summary.variantIndex === variant || summary.variantIndex === index),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!earlier) continue;
    const before = await service.read(earlier.id);
    if (!before.ok) return before;
    const shown = shownBySlot(timeline);
    for (const [slotId, key] of userChoices(before.value)) {
      // A slot the new template version no longer has can't keep anything.
      if (!shown.has(slotId) || shown.get(slotId) === key) continue;
      dropped.push({ slotId, timelineId: earlier.id, key });
    }
  }
  return ok(dropped);
}
