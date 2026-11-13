// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Handlers for core's GRAPHICS_COMMANDS (SPEC P3.4, HFW1): a graphic is a composition the Designer made. It goes on
 * the timeline as a proposal (`graphics.placeComposition`), gets a new design (`graphics.setComposition`), becomes
 * part of the video when the person uses it (`graphics.useProposal`), retimes and rewords (`graphics.edit`: its
 * anchor, its length and its variables; a designed graphic places and sizes itself) and goes (`graphics.remove`).
 * Each is a new timeline revision; its inverse is `timeline.restore` with the tracks as they were, so undo is exact.
 */
import {
  defineCommand,
  err,
  GRAPHICS_COMMANDS,
  graphicsCommandPayloads,
  NotFoundError,
  ok,
  TIMELINE_COMMANDS,
  type AsyncResult,
  type CommandOutcome,
} from '@taalcut/core';
import { GraphicInvalid } from '../errors-phase3';
import { compositionHandlers } from './composition-commands';
import {
  graphicWrites,
  withoutGraphic,
  withoutTextTrackItems,
  type CompositionCommandDeps,
  type GraphicReceipt,
} from './writes';

export type { CompositionCommandDeps, GraphicReceipt } from './writes';

export function createCompositionCommands(deps: CompositionCommandDeps) {
  const { load } = graphicWrites(deps);
  const compositions = compositionHandlers(deps);

  const edit = defineCommand({
    name: GRAPHICS_COMMANDS.edit,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.edit],
    sideEffect: 'write',
    handle: async (payload, context): AsyncResult<CommandOutcome<GraphicReceipt>> => {
      const timeline = await load(
        payload.projectId,
        payload.timelineId,
        context.replay === 'redo' ? undefined : payload.revision,
      );
      if (!timeline.ok) return timeline;
      const { tracks, item } = withoutGraphic(timeline.value, payload.itemId);
      if (!item) return err(NotFoundError({ entity: 'graphic', id: payload.itemId }));
      return compositions.editPlaced(payload, context, timeline.value, tracks, item);
    },
  });

  const remove = defineCommand({
    name: GRAPHICS_COMMANDS.remove,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.remove],
    sideEffect: 'write',
    handle: async (payload, context) => {
      const timeline = await load(
        payload.projectId,
        payload.timelineId,
        context.replay === 'redo' ? undefined : payload.revision,
      );
      if (!timeline.ok) return timeline;
      const ids = [
        ...new Set([...(payload.itemId ? [payload.itemId] : []), ...(payload.itemIds ?? [])]),
      ];
      const { tracks, removedIds, missing } = withoutTextTrackItems(timeline.value, ids);
      if (missing.length > 0 || removedIds.length === 0) {
        return err(NotFoundError({ entity: 'graphic', id: missing[0] ?? ids[0] ?? '' }));
      }
      const updated = await deps.timelines.update(
        timeline.value.id,
        (latest) => ({ ...latest, tracks }),
        context,
      );
      if (!updated.ok) return updated;
      return ok({
        result: {
          timelineId: timeline.value.id,
          affectedItemIds: removedIds,
          itemId: removedIds[0]!,
          revision: updated.value.revision,
        },
        inverse: {
          name: TIMELINE_COMMANDS.restore,
          payload: {
            projectId: payload.projectId,
            timelineId: timeline.value.id,
            tracks: timeline.value.tracks,
          },
        },
      });
    },
  });

  // EDT1-GFX: the person's "Use it" on a proposal; render.graphic_invalid for a graphic that isn't one.
  const useProposal = defineCommand({
    name: GRAPHICS_COMMANDS.useProposal,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.useProposal],
    sideEffect: 'write',
    handle: async (payload, context) => {
      const timeline = await load(
        payload.projectId,
        payload.timelineId,
        context.replay === 'redo' ? undefined : payload.revision,
      );
      if (!timeline.ok) return timeline;
      const { item } = withoutGraphic(timeline.value, payload.itemId);
      if (!item) return err(NotFoundError({ entity: 'graphic', id: payload.itemId }));
      if (!item.proposal) return err(GraphicInvalid({ kind: 'composition', field: 'proposal' }));
      const { proposal: _used, ...kept } = item;
      const tracks = timeline.value.tracks.map((track) =>
        track.kind !== 'text'
          ? track
          : { ...track, items: track.items.map((entry) => (entry.id === item.id ? kept : entry)) },
      );
      const updated = await deps.timelines.update(
        timeline.value.id,
        (latest) => ({ ...latest, tracks }),
        context,
      );
      if (!updated.ok) return updated;
      return ok({
        result: {
          timelineId: timeline.value.id,
          affectedItemIds: [item.id],
          itemId: item.id,
          revision: updated.value.revision,
        },
        inverse: {
          name: TIMELINE_COMMANDS.restore,
          payload: {
            projectId: payload.projectId,
            timelineId: timeline.value.id,
            tracks: timeline.value.tracks,
          },
        },
      });
    },
  });

  const { placeComposition, setComposition } = compositions;
  return {
    edit,
    remove,
    useProposal,
    placeComposition,
    setComposition,
    all: [edit, remove, useProposal, placeComposition, setComposition],
  };
}
