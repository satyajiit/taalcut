// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- error details as the real handlers write them: data for logs, not UI */

/**
 * HFW1-UI: the Designer's two timeline commands in the preview, mirroring render's: `graphics.placeComposition` puts
 * a graphic drawn with a composition that passed the gate on the timeline as a proposal (its copy joins
 * `graphicCompositions`; `replaces` takes off the proposal it tries again for), and `graphics.setComposition` gives
 * placed composition graphics a new design, each keeping its own values (the new design's variables only), place
 * and time. Both are new revisions whose inverse is timeline.restore. Made-up designs only: the fake draws nothing.
 */
import {
  defineCommand,
  err,
  GRAPHICS_COMMANDS,
  graphicsCommandPayloads,
  newId,
  NotFoundError,
  ok,
  PERSON_SOURCES,
  RationalTime,
  type AnyCommand,
  type GraphicComposition,
  type GraphicItem,
  type Timeline,
} from '@taalcut/core';
import { timelineError } from '../make/edits';
import type { Phase3Deps } from './phase3-deps';

type TextTrack = Extract<Timeline['tracks'][number], { kind: 'text' }>;

/** The timeline's copies with this one in it (once by id and hash; a newer version keeps the older beside it). */
function withCopy(timeline: Timeline, composition: GraphicComposition): Timeline['graphicCompositions'] {
  const copies = timeline.graphicCompositions ?? [];
  const held = copies.some((copy) => copy.id === composition.id && copy.hash === composition.hash);
  return held
    ? copies
    : [
        ...copies.filter((copy) => !(copy.id === composition.id && copy.version === composition.version)),
        composition,
      ];
}

/** On the first text track it fits on, else a new graphics track. */
function placed(tracks: Timeline['tracks'], item: GraphicItem): Timeline['tracks'] {
  const start = item.start.value;
  const end = start + item.duration.value;
  const fits = (track: Timeline['tracks'][number]): track is TextTrack =>
    track.kind === 'text' &&
    track.items.every(
      (other) => other.start.value + other.duration.value <= start || other.start.value >= end,
    );
  const target = tracks.find(fits);
  if (!target) {
    const taken = new Set(tracks.map((track) => track.id));
    let n = 2;
    while (taken.has(`T${n}`)) n++;
    return [...tracks, { kind: 'text', id: `T${n}`, name: 'Graphics', enabled: true, items: [item] }];
  }
  return tracks.map((track) =>
    track === target
      ? { ...target, items: [...target.items, item].sort((a, b) => a.start.value - b.start.value) }
      : track,
  );
}

export function createFakeDesignCommands(deps: Pick<Phase3Deps, 'make'>) {
  const timelines = deps.make.timelines;
  const load = (payload: { projectId: string; timelineId: Timeline['id'] }) => {
    const timeline = timelines.get(payload.timelineId);
    return timeline && timeline.projectId === payload.projectId
      ? ok(timeline)
      : err(timelineError('timeline.not_found', { timelineId: payload.timelineId }));
  };

  const placeComposition = defineCommand({
    name: GRAPHICS_COMMANDS.placeComposition,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.placeComposition],
    sideEffect: 'write',
    handle: (payload, context) => {
      const before = load(payload);
      if (!before.ok) return before;
      const timeline = before.value;
      const rate = timeline.canvas.rate;
      let tracks = timeline.tracks;
      if (payload.replaces) {
        const replaced = tracks.some(
          (track) =>
            track.kind === 'text' &&
            track.items.some(
              (item) => item.id === payload.replaces && item.type === 'graphic' && item.proposal,
            ),
        );
        if (!replaced) return err(NotFoundError({ entity: 'graphic', id: payload.replaces }));
        tracks = tracks.map((track) =>
          track.kind === 'text'
            ? { ...track, items: track.items.filter((item) => item.id !== payload.replaces) }
            : track,
        );
      }
      const frames = payload.duration
        ? RationalTime.toFrames(payload.duration, rate)
        : Math.round((payload.composition.durationSeconds * rate.num) / rate.den);
      const at = payload.anchor.kind === 'time' ? RationalTime.toFrames(payload.anchor.at, rate) : 0;
      const itemId = newId<'TimelineItem'>();
      const item: GraphicItem = {
        type: 'graphic',
        id: itemId,
        anchor: payload.anchor,
        start: RationalTime.of(Math.max(0, at), rate),
        duration: RationalTime.of(Math.max(1, frames), rate),
        placement: payload.placement ?? 'middle',
        styleKey: 'composition',
        language: null,
        origin: (PERSON_SOURCES as readonly string[]).includes(context.source) ? 'user' : 'agent',
        composition: { id: payload.composition.id, hash: payload.composition.hash, params: payload.params },
        proposal: payload.proposal,
        ...(payload.scale !== undefined ? { scale: payload.scale } : {}),
      };
      const next: Timeline = {
        ...timeline,
        tracks: placed(tracks, item),
        graphicCompositions: withCopy(timeline, payload.composition),
      };
      const written = timelines.write(payload.projectId, timeline, { ok: true, timeline: next });
      if (!written.ok) return written;
      return ok({ ...written.value, result: { ...written.value.result, itemId } });
    },
  });

  const setComposition = defineCommand({
    name: GRAPHICS_COMMANDS.setComposition,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.setComposition],
    sideEffect: 'write',
    handle: (payload) => {
      const before = load(payload);
      if (!before.ok) return before;
      const timeline = before.value;
      const names = new Set(payload.composition.variables.map((variable) => variable.name));
      const wanted = new Set<string>(payload.itemIds);
      let found = 0;
      const tracks = timeline.tracks.map((track) => {
        if (track.kind !== 'text') return track;
        return {
          ...track,
          items: track.items.map((item) => {
            if (item.type !== 'graphic' || !wanted.has(item.id) || !item.composition) return item;
            found += 1;
            const own = Object.fromEntries(
              Object.entries({ ...item.composition.params, ...payload.params }).filter(([name]) =>
                names.has(name),
              ),
            );
            return {
              ...item,
              composition: { id: payload.composition.id, hash: payload.composition.hash, params: own },
            };
          }),
        };
      });
      if (found !== wanted.size)
        return err(
          NotFoundError({ entity: 'graphic' }, { detail: 'not every graphic is a composition graphic here' }),
        );
      const next: Timeline = {
        ...timeline,
        tracks,
        graphicCompositions: withCopy(timeline, payload.composition),
      };
      return timelines.write(payload.projectId, timeline, { ok: true, timeline: next });
    },
  });

  const commands: AnyCommand[] = [placeComposition, setComposition];
  return { commands };
}
