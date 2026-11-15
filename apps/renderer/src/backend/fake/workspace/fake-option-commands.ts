// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: `graphics.chooseOption` in the preview, mirroring render's: the graphic (and every graphic of its set) is
 * drawn with the newest copy of the design the person picked, keeping the values the new design declares; a design
 * that isn't one of its options is render.graphic_invalid. A new revision whose inverse is timeline.restore, so ⌘Z
 * brings the one before back. Made-up designs only: the fake draws nothing.
 */
import {
  defineCommand,
  err,
  GRAPHICS_COMMANDS,
  graphicsCommandPayloads,
  NotFoundError,
  ok,
  TIMELINE_COMMANDS,
  type AnyCommand,
  type ErrorParams,
  type GraphicItem,
  type TaalcutError,
  type Timeline,
} from '@taalcut/core';
import { timelineError } from '../make/edits';
import type { Phase3Deps } from '../phase3/phase3-deps';

const codeError = (code: string, params?: ErrorParams): TaalcutError => ({
  code,
  messageKey: `errors.${code}`,
  retryable: false,
  ...(params ? { params } : {}),
});

export function createFakeOptionCommands(deps: Pick<Phase3Deps, 'make'>) {
  const timelines = deps.make.timelines;

  const chooseOption = defineCommand({
    name: GRAPHICS_COMMANDS.chooseOption,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.chooseOption],
    sideEffect: 'write',
    handle: (payload) => {
      const timeline = timelines.get(payload.timelineId);
      if (!timeline || timeline.projectId !== payload.projectId)
        return err(timelineError('timeline.not_found', { timelineId: payload.timelineId }));
      const graphics = timeline.tracks.flatMap((track) =>
        track.kind === 'text'
          ? track.items.filter((item): item is GraphicItem => item.type === 'graphic')
          : [],
      );
      const item = graphics.find((graphic) => graphic.id === payload.itemId);
      if (!item) return err(NotFoundError({ entity: 'graphic', id: payload.itemId }));
      const set = item.options?.set;
      if (!set || !item.options?.designs.some((design) => design.compositionId === payload.compositionId))
        return err(codeError('render.graphic_invalid', { kind: 'composition', field: 'options' }));
      const chosen = (timeline.graphicCompositions ?? [])
        .filter((copy) => copy.id === payload.compositionId)
        .sort((a, b) => b.version - a.version)[0];
      if (!chosen) return err(NotFoundError({ entity: 'graphicComposition', id: payload.compositionId }));
      const names = new Set(chosen.variables.map((variable) => variable.name));
      const tracks = timeline.tracks.map((track) =>
        track.kind !== 'text'
          ? track
          : {
              ...track,
              items: track.items.map((entry) => {
                if (entry.type !== 'graphic' || entry.options?.set !== set) return entry;
                const params = Object.fromEntries(
                  Object.entries(entry.composition.params).filter(([name]) => names.has(name)),
                );
                return { ...entry, composition: { id: chosen.id, hash: chosen.hash, params } };
              }),
            },
      );
      const next: Timeline = { ...timeline, tracks };
      const written = timelines.write(
        payload.projectId,
        timeline,
        { ok: true, timeline: next },
        {
          name: TIMELINE_COMMANDS.restore,
          payload: { projectId: timeline.projectId, timelineId: timeline.id, tracks: timeline.tracks },
        },
      );
      if (!written.ok) return written;
      return ok({ ...written.value, result: { ...written.value.result, itemId: item.id } });
    },
  });

  const commands: AnyCommand[] = [chooseOption];
  return { commands };
}
