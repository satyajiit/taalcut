// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2's graphics commands: a job's designs go on the timeline as each is ready (`graphics.placeOptions`,
 * `workspace.placeOptions`'s step) and the person swaps another in (`graphics.chooseOption`). The first design is in
 * the video as soon as it is placed: the graphic carries no proposal, so the preview, an export, QA and the make's
 * checks all draw it, and nothing waits on the person as plain text. It starts the graphic's set (`options`); each
 * later design joins that set (`join`) and the one in use stays, so a step that ends early leaves what it placed.
 * Every design's composition is kept in `graphicCompositions`. A job about text or graphics already there
 * redesigns them in place (each keeps its id, its time and its words), and a graphic that shares a set brings its
 * set along. Both inverses are `timeline.restore` with the tracks as they were, so undo is exact.
 */
import {
  ConflictError,
  defineCommand,
  err,
  GRAPHIC_OPTION_COUNT,
  GRAPHICS_COMMANDS,
  graphicsCommandPayloads,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  TIMELINE_COMMANDS,
  ValidationError,
  type AsyncResult,
  type CommandOutcome,
  type GraphicComposition,
  type GraphicItem,
  type GraphicOptions,
  type TextTrackItem,
  type Timeline,
  type TimelineId,
  type TimelineItemId,
} from '@taalcut/core';
import { GraphicInvalid } from '../errors-phase3';
import { COMPOSITION_STYLE_KEY, FULL_FRAME } from './composition-commands';
import {
  drawnWith,
  graphicsIn,
  newestCopy,
  textTrackItems,
  withDesigns,
  withSetMates,
  wordNames,
} from './options';
import { textComposition } from './text-composition';
import { resolveTiming } from './timing';
import { graphicWrites, isPerson, withGraphicOnTrack, type CompositionCommandDeps } from './writes';

/** What placing a set and choosing from one return. */
export interface OptionsReceipt {
  readonly timelineId: TimelineId;
  readonly affectedItemIds: string[];
  /** The first graphic of the set. */
  readonly itemId: TimelineItemId;
  readonly itemIds: TimelineItemId[];
  readonly revision: number;
  /** The design in use, by its composition. */
  readonly compositionId: string;
  /** The set's id. */
  readonly set: string;
  /** Phrases the anchor named that weren't found (a new graphic). */
  readonly unmatched: readonly string[];
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((name, at) => name === b[at]);

/** Why these designs can't be one set, or null: they must carry the same words. */
function setProblem(designs: readonly GraphicComposition[]): string | null {
  const words = wordNames(designs[0]!);
  const odd = designs.findIndex((design) => !same(wordNames(design), words));
  if (odd < 0) return null;
  return (
    `Design ${odd + 1} names its words ${wordNames(designs[odd]!).join(', ') || 'with no variable'}; design 1 names ` +
    `them ${words.join(', ') || 'with no variable'}. Every design of a set carries the same words: declare the ` +
    'same text variables in each'
  );
}

/** A copy the timeline already holds under a design's id and version with other files. */
function versionClash(
  timeline: Timeline,
  designs: readonly GraphicComposition[],
): GraphicComposition | undefined {
  return designs.find((design) =>
    (timeline.graphicCompositions ?? []).some(
      (copy) => copy.id === design.id && copy.version === design.version && copy.hash !== design.hash,
    ),
  );
}

export function optionHandlers(deps: CompositionCommandDeps) {
  const { load, timingFor } = graphicWrites(deps);

  const restore = (projectId: string, timeline: Timeline) => ({
    name: TIMELINE_COMMANDS.restore,
    payload: { projectId, timelineId: timeline.id, tracks: timeline.tracks },
  });

  const placeOptions = defineCommand({
    name: GRAPHICS_COMMANDS.placeOptions,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.placeOptions],
    sideEffect: 'write',
    handle: async (payload, context): AsyncResult<CommandOutcome<OptionsReceipt>> => {
      const loaded = await load(
        payload.projectId,
        payload.timelineId,
        context.replay === 'redo' ? undefined : payload.revision,
      );
      if (!loaded.ok) return loaded;
      const timeline = loaded.value;
      const designs = payload.designs.map((design) => design.composition);
      const first = designs[0]!;
      const offer = payload.designs.map((design) => ({
        compositionId: design.composition.id,
        idea: design.idea,
        ...(design.still ? { still: design.still } : {}),
      }));
      const clash = context.replay === 'redo' ? undefined : versionClash(timeline, designs);
      if (clash) return err(ConflictError({ entity: 'graphicComposition', id: clash.id }));

      // A later design of the job: it joins the set its graphics carry, and the design in use stays.
      if (payload.join) {
        const refuse = (detail: string) =>
          err(GraphicInvalid({ kind: 'composition', field: 'options' }, { detail }));
        const named = graphicsIn(timeline.tracks).filter((graphic) => payload.itemIds!.includes(graphic.id));
        const set = named[0]?.options;
        if (!set || named.length !== payload.itemIds!.length || named.some((g) => g.options?.set !== set.set))
          return refuse('These are not the graphics of one set: place the first design without join');
        const held = new Set<string>(set.designs.map((design) => design.compositionId));
        const twice = designs.find((design) => held.has(design.id));
        if (twice) return refuse(`${twice.name} is already one of this set's designs`);
        const room = GRAPHIC_OPTION_COUNT - set.designs.length;
        if (designs.length > room)
          return refuse(
            `The set has ${set.designs.length} of ${GRAPHIC_OPTION_COUNT} designs: room for ${room}`,
          );
        const used = newestCopy(named[0]!.composition.id, timeline.graphicCompositions);
        const words = setProblem(used ? [used, ...designs] : designs);
        if (words) return err(GraphicInvalid({ kind: 'composition', field: 'variables' }, { detail: words }));
        const grown: GraphicOptions = { ...set, designs: [...set.designs, ...offer] };
        const mates: string[] = [];
        const joined = timeline.tracks.map((track) =>
          track.kind !== 'text'
            ? track
            : {
                ...track,
                items: track.items.map((item) => {
                  if (item.type !== 'graphic' || item.options?.set !== set.set) return item;
                  mates.push(item.id);
                  return { ...item, options: grown };
                }),
              },
        );
        const kept = await deps.timelines.update(
          timeline.id,
          (latest) => withDesigns(latest, joined, designs, set.set),
          context,
        );
        if (!kept.ok) return kept;
        return ok({
          result: {
            timelineId: timeline.id,
            affectedItemIds: mates,
            itemId: mates[0] as TimelineItemId,
            itemIds: mates as TimelineItemId[],
            revision: kept.value.revision,
            compositionId: named[0]!.composition.id,
            set: set.set,
            unmatched: [],
          },
          inverse: restore(payload.projectId, timeline),
        });
      }

      const problem = setProblem(designs);
      if (problem)
        return err(GraphicInvalid({ kind: 'composition', field: 'variables' }, { detail: problem }));
      // Graphics offering these designs already are one set with this one: an option is one look for them all.
      const mate = graphicsIn(timeline.tracks).find(
        (graphic) =>
          graphic.options &&
          designs.every((design) =>
            graphic.options!.designs.some((offered) => offered.compositionId === design.id),
          ),
      );
      // The set starts with what is placed now, one design or more; the job's later designs join it.
      const options: GraphicOptions = mate?.options ?? {
        set: newId<'GraphicOptionSet'>(),
        request: payload.request,
        createdAt: payload.createdAt,
        designs: offer,
      };
      // A set already in the video keeps the design its graphics are drawn with.
      const use = (mate && designs.find((design) => design.id === mate.composition.id)) || first;
      const inUse = (item: GraphicItem): GraphicItem => {
        const { proposal: _used, options: _before, ...kept } = item;
        return { ...kept, options };
      };

      let tracks = timeline.tracks;
      let itemIds: string[];
      let unmatched: readonly string[] = [];
      if (payload.itemIds) {
        itemIds = withSetMates(timeline.tracks, payload.itemIds);
        const held = new Map<string, TextTrackItem>(
          textTrackItems(timeline.tracks).map((item) => [item.id, item]),
        );
        const missing = itemIds.find((id) => !held.has(id));
        if (missing)
          return err(
            NotFoundError(
              { entity: 'graphic', id: missing },
              { detail: 'Not a text or graphic on this timeline: read timeline.get for its itemId' },
            ),
          );
        const words = wordNames(first);
        if (itemIds.some((id) => held.get(id)?.type === 'text') && words.length !== 1)
          return err(
            GraphicInvalid(
              { kind: 'composition', field: 'variables' },
              {
                detail:
                  'Replacing native text requires exactly one text variable to preserve each title’s words',
              },
            ),
          );
        tracks = timeline.tracks.map((track) =>
          track.kind !== 'text'
            ? track
            : {
                ...track,
                items: track.items.map((item) => {
                  if (!itemIds.includes(item.id)) return item;
                  return inUse(
                    item.type === 'text'
                      ? textComposition(item, use, words[0] ?? '')
                      : drawnWith(item, timeline, use),
                  );
                }),
              },
        );
      } else {
        const rate = timeline.canvas.rate;
        const frames = payload.duration
          ? Math.max(1, RationalTime.toFrames(payload.duration, rate))
          : Math.max(1, Math.round((use.durationSeconds * rate.num) / rate.den));
        const timing = await timingFor(timeline);
        if (!timing.ok) return timing;
        const anchor = payload.anchor!;
        const resolved = resolveTiming({ anchor, frames, fallbackStart: 0 }, timing.value);
        const item = inUse({
          type: 'graphic',
          id: deps.newItemId?.() ?? newId<'TimelineItem'>(),
          anchor,
          start: RationalTime.of(resolved.start, rate),
          duration: RationalTime.of(resolved.end - resolved.start, rate),
          placement: payload.placement ?? FULL_FRAME,
          styleKey: COMPOSITION_STYLE_KEY,
          language: timeline.captions?.language ?? null,
          origin: isPerson(context) ? 'user' : 'agent',
          ...(payload.scale !== undefined ? { scale: payload.scale } : {}),
          composition: { id: use.id, hash: use.hash, params: payload.params ?? {} },
        });
        const placed = withGraphicOnTrack(timeline, item);
        if (!placed)
          return err(ValidationError({ field: 'tracks' }, { detail: 'No text track free for the graphic' }));
        tracks = placed;
        itemIds = [item.id];
        unmatched = resolved.unmatched;
      }

      const updated = await deps.timelines.update(
        timeline.id,
        (latest) => withDesigns(latest, tracks, designs, options.set),
        context,
      );
      if (!updated.ok) return updated;
      return ok({
        result: {
          timelineId: timeline.id,
          affectedItemIds: itemIds,
          itemId: itemIds[0] as TimelineItemId,
          itemIds: itemIds as TimelineItemId[],
          revision: updated.value.revision,
          compositionId: use.id,
          set: options.set,
          unmatched,
        },
        inverse: restore(payload.projectId, timeline),
      });
    },
  });

  const chooseOption = defineCommand({
    name: GRAPHICS_COMMANDS.chooseOption,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.chooseOption],
    sideEffect: 'write',
    handle: async (payload, context): AsyncResult<CommandOutcome<OptionsReceipt>> => {
      const loaded = await load(
        payload.projectId,
        payload.timelineId,
        context.replay === 'redo' ? undefined : payload.revision,
      );
      if (!loaded.ok) return loaded;
      const timeline = loaded.value;
      const item = graphicsIn(timeline.tracks).find((graphic) => graphic.id === payload.itemId);
      if (!item) return err(NotFoundError({ entity: 'graphic', id: payload.itemId }));
      const offered = item.options?.designs.some((design) => design.compositionId === payload.compositionId);
      if (!item.options || !offered)
        return err(
          GraphicInvalid(
            { kind: 'composition', field: 'options' },
            { detail: 'That design is not one of this graphic’s options: graphics.list names them' },
          ),
        );
      const chosen = newestCopy(payload.compositionId, timeline.graphicCompositions);
      if (!chosen) return err(NotFoundError({ entity: 'graphicComposition', id: payload.compositionId }));
      const set = item.options.set;
      const itemIds: string[] = [];
      const tracks = timeline.tracks.map((track) =>
        track.kind !== 'text'
          ? track
          : {
              ...track,
              items: track.items.map((entry) => {
                if (entry.type !== 'graphic' || entry.options?.set !== set) return entry;
                itemIds.push(entry.id);
                // Whose words they are doesn't change with the look: the graphic's origin stays.
                return drawnWith(entry, timeline, chosen);
              }),
            },
      );
      const updated = await deps.timelines.update(timeline.id, (latest) => ({ ...latest, tracks }), context);
      if (!updated.ok) return updated;
      return ok({
        result: {
          timelineId: timeline.id,
          affectedItemIds: itemIds,
          itemId: item.id,
          itemIds: itemIds as TimelineItemId[],
          revision: updated.value.revision,
          compositionId: chosen.id,
          set,
          unmatched: [],
        },
        inverse: restore(payload.projectId, timeline),
      });
    },
  });

  return { placeOptions, chooseOption };
}
