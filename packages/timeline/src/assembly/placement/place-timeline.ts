// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A made timeline's text on its canvas (FRM1-OVL, TXT1). No code chooses where a made video's text sits.
 * `reelTextLayout` is where its text starts: each text where the reel had it, the texts the reel showed in turn at
 * one place together at one place and one size (runs.ts); a text someone placed is never touched. What the solver
 * finds is `candidatePlaces`: the clips' subject spans laid on the canvas (subjects.ts), the captions and every item
 * not being placed as obstacles, the solver over the text groups. It is information for whoever places the text,
 * never applied. Pure: the subject spans come in, read by run-placement.ts `spansFor`.
 */
import type {
  CaptionTrack,
  PlacementReason,
  SubjectSpan,
  Template,
  TextTrackItem,
  Timeline,
} from '@taalcut/core';
import { textTracks } from '../../model/sequence';
import type { Rect, Size } from './geometry';
import { footprintOf, ownedItem, safeFor, TEXT_HALO, type Owned } from './place-items';
import { placedUnits, runMates, runSizes } from './runs';
import { SOLVER_CONFIG, solvePlacements } from './solve';
import { framesDuring, placedClips, sceneFramesOf } from './subjects';
import type { Obstacle, Scene, SolverConfig } from './types';

export interface PlaceInput {
  readonly timeline: Timeline;
  readonly template: Template;
  /** Each V1 clip's subject span, by clip id; absent or undefined: nothing known of who is in it. */
  readonly subjects: ReadonlyMap<string, SubjectSpan | undefined>;
  /** The items to place; default every item a reel overlay made. The others stay put as obstacles. */
  readonly only?: ReadonlySet<string>;
  readonly config?: SolverConfig;
}

/** Each burnt-in cue's band, as render estimates it before laying the words out (graphic-placement.ts). */
export function captionObstacles(
  captions: CaptionTrack | null,
  canvas: Size,
  safe: Rect,
  fps: number,
): Obstacle[] {
  if (!captions?.enabled) return [];
  const { style } = captions;
  const chrome = 2 * (style.background?.paddingPx ?? 0) + 2 * (style.stroke?.widthPx ?? 0);
  const height = Math.round(style.sizePx * 1.2) * style.maxLines + chrome;
  const top = Math.min(
    Math.max(style.anchorY * canvas.height - height / 2, safe.y),
    safe.y + safe.height - height,
  );
  return captions.cues.map((cue) => {
    const start = Math.round(
      (cue.range.start.value * cue.range.start.rate.den * fps) / cue.range.start.rate.num,
    );
    const frames = Math.round(
      (cue.range.duration.value * cue.range.duration.rate.den * fps) / cue.range.duration.rate.num,
    );
    return { span: { start, end: start + frames }, box: { x: safe.x, y: top, width: safe.width, height } };
  });
}

const spanOf = (item: TextTrackItem) => ({
  start: item.start.value,
  end: item.start.value + item.duration.value,
});

/** The scene of a timeline: its clips' people on the canvas, its captions, and the items not being placed. */
export function sceneOf(
  input: Pick<PlaceInput, 'timeline' | 'subjects'>,
  fixed: readonly TextTrackItem[],
): Scene {
  const { timeline } = input;
  const canvas = { width: timeline.canvas.width, height: timeline.canvas.height };
  const fps = timeline.canvas.rate.num / timeline.canvas.rate.den;
  const clips = placedClips(timeline).map((placed) => ({ placed, span: input.subjects.get(placed.clip.id) }));
  const frames = sceneFramesOf(clips, canvas, fps);
  const safe = safeFor('graphic', canvas);
  const obstacles: Obstacle[] = [
    ...captionObstacles(timeline.captions, canvas, safeFor('text', canvas), fps),
    ...fixed.flatMap((item) => {
      const box = footprintOf(item, canvas);
      return box ? [{ span: spanOf(item), box }] : [];
    }),
  ];
  return { canvas, safe, obstacles, frames: (span) => framesDuring(frames, span, fps) };
}

/** Text and graphic items on enabled text tracks, with their track. */
function textItems(timeline: Timeline): TextTrackItem[] {
  return textTracks(timeline)
    .filter((track) => track.enabled)
    .flatMap((track) => track.items);
}

function ownedOf(input: PlaceInput, items: readonly TextTrackItem[]): Owned[] {
  const surface = {
    canvas: { width: input.timeline.canvas.width, height: input.timeline.canvas.height },
    template: input.template,
  };
  // TXT1: a text is never placed on its own out of its run: the run's other texts nobody placed come along.
  const mates = input.only ? runMates(items, input.template, input.only) : null;
  const wanted = (item: TextTrackItem) =>
    !input.only ||
    input.only.has(item.id) ||
    (mates!.has(item.id) && item.type === 'text' && item.placement !== undefined);
  // A run's texts are one size: the middle of the reel's own sizes for them.
  const sizes = runSizes(input.template, surface);
  return items.flatMap((item) => {
    if (!wanted(item)) return [];
    const size = item.type === 'text' && item.overlayId ? sizes.get(item.overlayId) : undefined;
    const owned = ownedItem(item, surface, size);
    return owned ? [owned] : [];
  });
}

/**
 * The text items, solved in a text item's safe area (a little wider than a graphic's: render's own margins). HFW1
 * retire: graphics are compositions the solver keeps clear of (the scene's obstacles), never places.
 */
function solveAll(owned: readonly Owned[], scene: Scene, input: PlaceInput) {
  const config = input.config ?? SOLVER_CONFIG;
  const textScene: Scene = { ...scene, safe: safeFor('text', scene.canvas) };
  const units = placedUnits(owned, input.template);
  const placed = solvePlacements(
    units.map((unit) => unit.request),
    textScene,
    config,
  );
  return units.map((unit, index) => ({ unit, placed: placed[index]! }));
}

/** TXT1: where the solver would put one text group, were it asked: a candidate, never applied. */
export interface CandidatePlace {
  /** The group's texts as the solver would set them. Nothing stores them. */
  readonly items: readonly TextTrackItem[];
  readonly reason: PlacementReason;
  /** With no place clear of every head: the share of the group's sampled frames a head is under it there. */
  readonly covered?: number;
}

/** TXT1: the solver's place for each text group the reel made. Nothing is changed. */
export function candidatePlaces(input: PlaceInput): CandidatePlace[] {
  const items = textItems(input.timeline);
  const owned = ownedOf(input, items);
  if (owned.length === 0) return [];
  const ids = new Set(owned.map((entry) => entry.item.id));
  const scene = sceneOf(
    input,
    items.filter((item) => !ids.has(item.id)),
  );
  return solveAll(owned, scene, input).map(({ unit, placed }) => ({
    items: unit.apply(placed.box, placed.scale, placed.reason),
    reason: placed.reason,
    ...(placed.covered !== undefined ? { covered: placed.covered } : {}),
  }));
}

/**
 * TXT1: where a made video's text starts, and all that code does about its place: every text the reel made that
 * nobody has placed (`placedBy`) sits where the reel had it, a run's texts together at the run's one place and one
 * size, set against each other as the reel set them, each on one line for each line it is written on (its box
 * follows its words). No head, caption or safe area moves any of it, and it is the same however often it runs. `asked` places these texts whoever placed them ("as the reel has it").
 */
export function reelTextLayout(
  input: Pick<PlaceInput, 'timeline' | 'template' | 'only'> & { readonly asked?: ReadonlySet<string> },
): Timeline {
  const { timeline } = input;
  const free = (item: TextTrackItem) =>
    item.type !== 'text' || item.placedBy === undefined || input.asked?.has(item.id) === true;
  const owned = ownedOf({ ...input, subjects: new Map() }, textItems(timeline).filter(free));
  if (owned.length === 0) return timeline;
  const { width, height } = timeline.canvas;
  // The frame's edge: a unit whose words would reach past it moves, as one, the least that brings them inside.
  const inside = (from: number, length: number, limit: number) =>
    Math.min(Math.max(0, from + TEXT_HALO), Math.max(0, limit - (length - 2 * TEXT_HALO))) - TEXT_HALO;
  const next = new Map<string, TextTrackItem>();
  for (const unit of placedUnits(owned, input.template)) {
    const reel = unit.request.reel;
    const at = { ...reel, x: inside(reel.x, reel.width, width), y: inside(reel.y, reel.height, height) };
    for (const item of unit.apply(at, 1, 'asReel')) next.set(item.id, item);
  }
  const tracks = timeline.tracks.map((track) =>
    track.kind === 'text' ? { ...track, items: track.items.map((item) => next.get(item.id) ?? item) } : track,
  );
  return { ...timeline, tracks };
}
