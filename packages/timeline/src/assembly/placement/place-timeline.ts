// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A made timeline's overlay items placed (FRM1-OVL): the clips' subject spans laid on the canvas (subjects.ts),
 * the captions and every item not being placed as obstacles, the solver over the items that are (every reel
 * overlay on a fresh assembly; the ones an edit touched after it), and each chosen box written back with its
 * reason. Pure: the subject spans come in, read by run-placement.ts.
 */
import type {
  CaptionTrack,
  OverlayPlacement,
  PlacementReason,
  SubjectSpan,
  Template,
  TextTrackItem,
  Timeline,
} from '@taalcut/core';
import { textTracks } from '../../model/sequence';
import { spansOverlap, type Rect, type Size } from './geometry';
import { footprintOf, ownedItem, safeFor, type Owned } from './place-items';
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

export interface PlacementReport {
  readonly id: string;
  readonly reason: PlacementReason;
  readonly relation: OverlayPlacement;
  /** The main head's side it ended on, or null with nobody on screen. */
  readonly side: OverlayPlacement['side'] | null;
  readonly scale: number;
  /** The V1 clips on screen during it. */
  readonly clipIds: readonly string[];
  readonly span: { readonly start: number; readonly end: number };
}

export interface PlaceResult {
  readonly timeline: Timeline;
  readonly report: readonly PlacementReport[];
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
export function sceneOf(input: PlaceInput, fixed: readonly TextTrackItem[]): Scene {
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
  return items.flatMap((item) => {
    if (input.only && !input.only.has(item.id)) return [];
    const owned = ownedItem(item, surface);
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
  const placed = solvePlacements(
    owned.map((entry) => entry.request),
    textScene,
    config,
  );
  return owned.map((entry, index) => ({ entry, placed: placed[index]! }));
}

export function placeOverlays(input: PlaceInput): PlaceResult {
  const { timeline } = input;
  const items = textItems(timeline);
  const owned = ownedOf(input, items);
  if (owned.length === 0) return { timeline, report: [] };
  const ids = new Set(owned.map((entry) => entry.item.id));
  const scene = sceneOf(
    input,
    items.filter((item) => !ids.has(item.id)),
  );
  const solved = solveAll(owned, scene, input);
  const next = new Map<string, TextTrackItem>();
  const clips = placedClips(timeline);
  const report: PlacementReport[] = solved.map(({ entry, placed }) => {
    next.set(entry.item.id, entry.apply(placed.box, placed.scale, placed.reason));
    return {
      id: entry.item.id,
      reason: placed.reason,
      relation: entry.request.relation,
      side: placed.side,
      scale: placed.scale,
      clipIds: clips
        .filter((clip) => spansOverlap(clip.seen, entry.request.span))
        .map((clip) => clip.clip.id),
      span: entry.request.span,
    };
  });
  const tracks = timeline.tracks.map((track) =>
    track.kind === 'text' ? { ...track, items: track.items.map((item) => next.get(item.id) ?? item) } : track,
  );
  return { timeline: { ...timeline, tracks }, report };
}
