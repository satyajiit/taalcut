// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1's graphics commands: the Designer's composition goes on the timeline as a proposal
 * (`graphics.placeComposition`, `workspace.place`'s step) and graphics already placed get a new design
 * (`graphics.setComposition`, `workspace.replace`'s). The composition joins the timeline's `graphicCompositions`
 * in the same step (at most 48 kept, the ones no graphic names dropped first). A composition lays itself out on the
 * whole canvas, so its graphic's placement is the full frame unless one is given; it is timed against the words as
 * any graphic is. Both inverses are `timeline.restore` with the tracks as they were: the copy stays, unused.
 */
import type { z } from 'zod';
import {
  compositionFor,
  ConflictError,
  defineCommand,
  err,
  GRAPHICS_COMMANDS,
  graphicsCommandPayloads,
  MAX_TIMELINE_COMPOSITIONS,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  TIMELINE_COMMANDS,
  type AsyncResult,
  type CommandContext,
  type CommandOutcome,
  type GraphicComposition,
  type GraphicItem,
  type Timeline,
  type TextTrackItem,
} from '@taalcut/core';
import { GraphicInvalid } from '../errors-phase3';
import { resolveTiming } from './timing';
import { replacementTracks } from './replacement-tracks';
import {
  graphicWrites,
  isPerson,
  withoutGraphic,
  type CompositionCommandDeps,
  type GraphicReceipt,
} from './writes';

/** A composition graphic's placement: the whole frame, which the composition lays out itself. */
export const FULL_FRAME = { box: { x: 0, y: 0, width: 1, height: 1 } } as const;

/**
 * Why a composition graphic doesn't move or resize by the item: it places itself (`graphics.edit` and the inspector
 * send the words to the Designer instead).
 */
export const PLACES_ITSELF =
  'A designed graphic places and sizes itself: ask graphics.design with the words ("move it up a little", ' +
  '"make it smaller") and its itemId';

/** The style key a composition graphic carries (it has no kit kind to key a look by). */
export const COMPOSITION_STYLE_KEY = 'composition';

const refsOf = (tracks: Timeline['tracks']) =>
  new Set(
    tracks.flatMap((track) =>
      track.kind === 'text'
        ? track.items.flatMap((item) =>
            item.type === 'graphic' && item.composition
              ? [`${item.composition.id}@${item.composition.hash}`]
              : [],
          )
        : [],
    ),
  );

/** The timeline's copies with `composition` added (once), keeping every one a graphic names. */
export function withComposition(timeline: Timeline, composition: GraphicComposition): Timeline {
  const named = refsOf(timeline.tracks);
  const others = (timeline.graphicCompositions ?? []).filter(
    (copy) =>
      !(
        copy.id === composition.id &&
        (copy.hash === composition.hash || copy.version === composition.version)
      ),
  );
  const used = others.filter((copy) => named.has(`${copy.id}@${copy.hash}`));
  const unused = others.filter((copy) => !named.has(`${copy.id}@${copy.hash}`));
  const room = Math.max(0, MAX_TIMELINE_COMPOSITIONS - 1 - used.length);
  return { ...timeline, graphicCompositions: [...used, ...unused.slice(-room), composition] };
}

/** Each named text or graphic, so a restyled native title is replaced instead of duplicated. */
function compositionGraphics(timeline: Timeline, itemIds: readonly string[]) {
  const found = new Map<string, TextTrackItem>();
  for (const track of timeline.tracks)
    if (track.kind === 'text')
      for (const item of track.items) if (itemIds.includes(item.id)) found.set(item.id, item);
  const missing = itemIds.find((id) => !found.has(id));
  return missing ? { missing } : { items: found };
}

type EditPayload = z.output<(typeof graphicsCommandPayloads)[typeof GRAPHICS_COMMANDS.edit]>;

/** placeComposition, setComposition, and graphics.edit of a placed composition graphic (its time and words). */
export function compositionHandlers(deps: CompositionCommandDeps) {
  const { load, timingFor, write } = graphicWrites(deps);

  /**
   * `graphics.edit` on a composition graphic: what isn't design. It retimes (anchor, duration) and rewords through
   * its variables (params, merged over its own). A composition places and sizes itself with its CSS, so render draws
   * it without the item's placement and scale: moving or resizing it, like a change to its look, is a design job for
   * the Designer (graphics.design), and is refused here with that hint.
   */
  async function editPlaced(
    payload: EditPayload,
    context: CommandContext,
    timeline: Timeline,
    tracks: Timeline['tracks'],
    item: GraphicItem,
  ): AsyncResult<CommandOutcome<GraphicReceipt>> {
    const moved =
      payload.placement !== undefined && JSON.stringify(payload.placement) !== JSON.stringify(item.placement);
    const sized = payload.scale !== undefined && payload.scale !== (item.scale ?? 1);
    if (moved || sized)
      return err(
        GraphicInvalid(
          { kind: 'composition', field: moved ? 'placement' : 'scale' },
          { detail: PLACES_ITSELF },
        ),
      );
    const copy = compositionFor(item.composition, timeline.graphicCompositions);
    const names = new Set(copy?.variables.map((variable) => variable.name) ?? []);
    const unknown = Object.keys(payload.params ?? {}).find((name) => !names.has(name));
    if (unknown !== undefined)
      return err(
        GraphicInvalid(
          { kind: 'composition', field: 'params' },
          // HFW1 gate: the names themselves, so a model fixes the call instead of redesigning the graphic.
          {
            detail: `Its design has no variable ${unknown}; its variables are ${[...names].join(', ') || 'none'}`,
          },
        ),
      );
    const rate = timeline.canvas.rate;
    const frames = payload.duration
      ? Math.max(1, RationalTime.toFrames(payload.duration, rate))
      : Math.max(1, RationalTime.toFrames(item.duration, rate));
    const words = await timingFor({ ...timeline, tracks });
    if (!words.ok) return words;
    const anchor = payload.anchor ?? item.anchor;
    const fallbackStart = RationalTime.toFrames(item.start, rate);
    const timing = resolveTiming({ anchor, frames, fallbackStart }, words.value);
    const edited: GraphicItem = {
      ...item,
      anchor,
      start: RationalTime.of(timing.start, rate),
      duration: RationalTime.of(timing.end - timing.start, rate),
      origin: isPerson(context) ? 'user' : item.origin,
      composition: { ...item.composition, params: { ...item.composition.params, ...payload.params } },
    };
    return write(payload.projectId, timeline, tracks, edited, timing.unmatched, context);
  }

  const placeComposition = defineCommand({
    name: GRAPHICS_COMMANDS.placeComposition,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.placeComposition],
    sideEffect: 'write',
    handle: async (payload, context): AsyncResult<CommandOutcome<GraphicReceipt>> => {
      const timeline = await load(
        payload.projectId,
        payload.timelineId,
        context.replay === 'redo' ? undefined : payload.revision,
      );
      if (!timeline.ok) return timeline;
      let tracks = timeline.value.tracks;
      if (payload.replaces) {
        const without = withoutGraphic(timeline.value, payload.replaces);
        if (!without.item) return err(NotFoundError({ entity: 'graphic', id: payload.replaces }));
        if (!without.item.proposal) return err(GraphicInvalid({ kind: 'composition', field: 'replaces' }));
        tracks = without.tracks;
      }
      const { composition } = payload;
      const rate = timeline.value.canvas.rate;
      const frames = payload.duration
        ? Math.max(1, RationalTime.toFrames(payload.duration, rate))
        : Math.max(1, Math.round((composition.durationSeconds * rate.num) / rate.den));
      const words = await timingFor({ ...timeline.value, tracks });
      if (!words.ok) return words;
      const timing = resolveTiming({ anchor: payload.anchor, frames, fallbackStart: 0 }, words.value);
      const item: GraphicItem = {
        type: 'graphic',
        id: deps.newItemId?.() ?? newId<'TimelineItem'>(),
        anchor: payload.anchor,
        start: RationalTime.of(timing.start, rate),
        duration: RationalTime.of(timing.end - timing.start, rate),
        placement: payload.placement ?? FULL_FRAME,
        styleKey: COMPOSITION_STYLE_KEY,
        language: timeline.value.captions?.language ?? null,
        origin: isPerson(context) ? 'user' : 'agent',
        proposal: payload.proposal,
        ...(payload.scale !== undefined ? { scale: payload.scale } : {}),
        composition: { id: composition.id, hash: composition.hash, params: payload.params },
      };
      return write(payload.projectId, timeline.value, tracks, item, timing.unmatched, context, (latest) =>
        withComposition(latest, composition),
      );
    },
  });

  const setComposition = defineCommand({
    name: GRAPHICS_COMMANDS.setComposition,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.setComposition],
    sideEffect: 'write',
    handle: async (payload, context) => {
      const timeline = await load(
        payload.projectId,
        payload.timelineId,
        context.replay === 'redo' ? undefined : payload.revision,
      );
      if (!timeline.ok) return timeline;
      const { composition } = payload;
      const found = compositionGraphics(timeline.value, payload.itemIds);
      if ('missing' in found)
        return err(
          NotFoundError(
            { entity: 'graphic', id: found.missing },
            { detail: 'Not a text or graphic on this timeline: read timeline.get for its itemId' },
          ),
        );
      const textVariables = composition.variables.filter((variable) => variable.type === 'text');
      if ([...found.items.values()].some((item) => item.type === 'text') && textVariables.length !== 1)
        return err(
          GraphicInvalid(
            { kind: 'composition', field: 'variables' },
            {
              detail:
                'Replacing native text requires exactly one text variable to preserve each title’s words',
            },
          ),
        );
      const held = (timeline.value.graphicCompositions ?? []).filter((copy) => copy.id === composition.id);
      if (
        held.some(
          (copy) =>
            copy.version >= composition.version &&
            !(
              context.replay === 'redo' &&
              copy.version === composition.version &&
              copy.hash === composition.hash
            ),
        )
      )
        return err(ConflictError({ entity: 'graphicComposition', id: composition.id }));
      const update = (latest: Timeline): Timeline =>
        withComposition(
          {
            ...latest,
            tracks: replacementTracks(
              latest,
              payload.itemIds,
              composition,
              textVariables[0]?.name ?? '',
              payload.params,
            ),
          },
          composition,
        );
      const updated = await deps.timelines.update(timeline.value.id, update, context);
      if (!updated.ok) return updated;
      return ok({
        result: {
          itemIds: [...found.items.keys()],
          compositionId: composition.id,
          version: composition.version,
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

  return { placeComposition, setComposition, editPlaced };
}
