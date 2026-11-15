// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: what the tools tell whoever places a video's text, group by group (styles/place-text.ts `textGroups`).
 * Facts only: where the group sits and how large it is, the capitals' height in pixels, how many lines each of its
 * texts draws on and whether a line of it is wider than the frame at that size, whether it is at the frame's edge, on what share of the frames it is on a face or a person is under it, which platforms' own interface
 * would cover it (provisional), where and how large the reference had it, and the place the solver finds for it (a
 * candidate). And one line on the video's system as it stands: how many sizes and places each role uses, so
 * inconsistency shows. Nothing here judges, moves or refuses anything, and nothing reads what the words say.
 */
import {
  READABLE_CAP_PX,
  type SubjectSource,
  type Template,
  type TextItem,
  type Timeline,
} from '@taalcut/core';
import { intersects, toPixels, type Rect } from '../assembly/placement/geometry';
import { candidatePlaces, reelTextLayout, sceneOf } from '../assembly/placement/place-timeline';
import { EDIT_ENSURE_MS, spansFor } from '../assembly/placement/run-placement';
import { clipSourceRange, placedClips } from '../assembly/placement/subjects';
import { platformAreas, platformsOver, type Platform } from '../assembly/platform-areas';
import { groupPlace, textGroups, type GroupPlace, type TextGroup } from '../styles/place-text';
import { fitOf } from '../styles/text-box';

const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;

export interface PlaceFacts {
  readonly x: number;
  readonly y: number;
  readonly align: string;
  readonly size: number;
  /** The capitals' height on this video, pixels. */
  readonly capPx: number;
}

export interface GroupFacts extends PlaceFacts {
  /** The group's handle: any of its texts' ids names it to timeline.placeText. */
  readonly group: string;
  readonly role: string;
  readonly texts: number;
  /** Shown in turn at one place by the reference: placed as one. */
  readonly run: boolean;
  readonly example: string;
  readonly fromSeconds: number;
  readonly toSeconds: number;
  /** Who stated its place: nobody yet (it sits where the reference had it), the AI, or the person (it stays). */
  readonly placedBy: 'nobody' | 'ai' | 'person';
  /** The lines each of its texts draws on as placed, in the order they show. One line unless a break is stated. */
  readonly lines: number[];
  /** The width its words wrap at, a share of the frame's, when one is stated; null: one line for each written line. */
  readonly wrapAt: number | null;
  /**
   * A line of it is wider than the frame at this size, so it wraps at the frame's width: the frame-edge rule, and
   * `atFrameEdge` is true. A smaller size or a stated break puts it on the lines meant.
   */
  readonly widerThanFrame: boolean;
  /**
   * It touches the frame's edge. A text is never stored past the edge: a place stated past it ends here, so the
   * place reported is not the one stated.
   */
  readonly atFrameEdge: boolean;
  /** Of the frames it is on: the share with a face under it, and with a person; null when nobody was tracked. */
  readonly under: { readonly face: number; readonly person: number; readonly frames: number } | null;
  /** The platforms whose own interface would cover part of it (provisional numbers; 9:16 only). */
  readonly coveredBy: Platform[];
  /** Where and how large the reference had it, on this video; null for a text the reference did not have. */
  readonly reel: PlaceFacts | null;
  /**
   * A place the solver finds for it: clear of faces, captions and other items where `clear`, else the least
   * covered one, with the share of frames a face is under it there. One candidate, not a rule.
   */
  readonly candidate: (PlaceFacts & { readonly clear: boolean; readonly faceUnder?: number }) | null;
}

export interface TextFacts {
  readonly groups: GroupFacts[];
  /** The groups with a text from the reference nobody has placed yet. */
  readonly unplaced: string[];
  /** The video's text as one system, role by role: its sizes and its places. */
  readonly system: string;
  /** The reading fact, in this video's pixels. */
  readonly reading: string;
  /** What `coveredBy` rests on: provisional areas, or nothing for a video that is not 9:16. */
  readonly platformsNote: string;
}

export interface TextFactsDeps {
  readonly subjects?: SubjectSource;
}

/** The reading fact for a canvas: QA's own measure, said plainly. Nothing holds a text to it. */
export function readingFact(canvas: Pick<Timeline['canvas'], 'width' | 'height'>): string {
  const px = Math.round((READABLE_CAP_PX * Math.min(canvas.width, canvas.height)) / 1080);
  return `Capitals under ${px} px on this video are hard to read on a phone.`;
}

const placeFacts = (place: GroupPlace, canvas: Timeline['canvas']): PlaceFacts => ({
  x: round(place.x),
  y: round(place.y),
  align: place.align,
  size: round(place.size),
  capPx: Math.round(place.size * canvas.height),
});

const placer = (items: readonly TextItem[]): GroupFacts['placedBy'] =>
  items.some((item) => item.overlayId !== null && item.placedBy === undefined)
    ? 'nobody'
    : items.some((item) => item.placedBy === 'person')
      ? 'person'
      : 'ai';

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line on the system: for each role, its texts, and how many sizes and places its groups use. */
export function systemLine(groups: readonly GroupFacts[]): string {
  return [...new Set(groups.map((group) => group.role))]
    .map((role) => {
      const mine = groups.filter((group) => group.role === role);
      const texts = mine.reduce((sum, group) => sum + group.texts, 0);
      const sizes = [...new Set(mine.map((group) => group.capPx))].sort((a, b) => a - b);
      const places = new Set(mine.map((group) => `${round(group.x, 2)},${round(group.y, 2)},${group.align}`));
      return (
        `${role}: ${count(texts, 'text')} in ${count(mine.length, 'group')}, ` +
        `${count(sizes.length, 'size')} (${sizes.join(', ')} px), ${count(places.size, 'place')}`
      );
    })
    .join('; ');
}

/** The people in the video's clips, as stored (waiting a moment for tracks still being made). */
async function peopleOf(timeline: Timeline, deps: TextFactsDeps) {
  if (!deps.subjects) return null;
  const rate = timeline.canvas.rate;
  const ranges = placedClips(timeline).flatMap((placed) =>
    placed.clip.media.kind === 'video'
      ? [
          {
            key: placed.clip.id as string,
            range: { assetId: placed.clip.media.assetId, ...clipSourceRange(placed.clip, rate) },
          },
        ]
      : [],
  );
  const subjects = await spansFor(deps.subjects, ranges, [], { ensureBudgetMs: EDIT_ENSURE_MS });
  return { subjects, scene: sceneOf({ timeline, subjects }, []) };
}

const atEdge = (box: GroupPlace['box']) =>
  box.x < 1e-6 || box.y < 1e-6 || box.x + box.width > 1 - 1e-6 || box.y + box.height > 1 - 1e-6;

const textsIn = (timeline: Timeline, ids: ReadonlySet<string>): TextItem[] =>
  timeline.tracks
    .flatMap((track) => (track.kind === 'text' ? track.items : []))
    .filter((item): item is TextItem => item.type === 'text' && ids.has(item.id));

/** The facts of every text group of the video; `groups` holds only those with one of `only`, when given. */
export async function textFacts(
  timeline: Timeline,
  template: Template | null,
  deps: TextFactsDeps,
  only?: ReadonlySet<string>,
): Promise<TextFacts> {
  const canvas = timeline.canvas;
  const fps = canvas.rate.num / canvas.rate.den;
  const all = textGroups(timeline, template);
  const people = all.length > 0 ? await peopleOf(timeline, deps) : null;
  const candidates =
    template && people ? candidatePlaces({ timeline, template, subjects: people.subjects }) : [];

  const facts = (group: TextGroup): GroupFacts => {
    const { items } = group;
    const now = groupPlace(items);
    const span = {
      start: Math.min(...items.map((item) => item.start.value)),
      end: Math.max(...items.map((item) => item.start.value + item.duration.value)),
    };
    const box: Rect = toPixels(now.box, canvas);
    const frames = people ? people.scene.frames(span) : [];
    const share = (rects: (frame: (typeof frames)[number]) => readonly Rect[]) =>
      round(
        frames.filter((frame) => rects(frame).some((rect) => intersects(box, rect))).length / frames.length,
        2,
      );
    const ids = new Set<string>(items.map((item) => item.id));
    // Where the reference had it: the starting layout for these texts, read and never stored.
    const reeled = template
      ? textsIn(reelTextLayout({ timeline, template, only: ids, asked: ids }), ids).filter(
          (item) => item.overlayId !== null,
        )
      : [];
    const fits = items.map((item) => fitOf(item, canvas));
    const wrapped = items.filter((item) => item.breaks !== 'written');
    const found = candidates.find((candidate) => candidate.items.some((item) => ids.has(item.id)));
    const spot = (found?.items ?? []).filter(
      (item): item is TextItem => item.type === 'text' && ids.has(item.id),
    );
    return {
      group: group.id,
      role: items[0]!.styleKey,
      texts: items.length,
      run: group.run,
      example: items[0]!.text.slice(0, 40),
      fromSeconds: round(span.start / fps, 2),
      toSeconds: round(span.end / fps, 2),
      ...placeFacts(now, canvas),
      placedBy: placer(items),
      lines: fits.map((fit) => fit.lines),
      wrapAt: wrapped.length > 0 ? round(Math.max(...wrapped.map((item) => item.box.width))) : null,
      widerThanFrame: fits.some((fit) => fit.widerThanFrame),
      atFrameEdge: atEdge(now.box),
      under:
        frames.length > 0
          ? {
              face: share((frame) => frame.heads),
              person: share((frame) => frame.people),
              frames: frames.length,
            }
          : null,
      coveredBy: platformsOver(now.box, canvas),
      reel: reeled.length > 0 ? placeFacts(groupPlace(reeled), canvas) : null,
      candidate:
        found && spot.length > 0
          ? {
              ...placeFacts(groupPlace(spot), canvas),
              clear: found.reason !== 'noRoom',
              ...(found.covered !== undefined ? { faceUnder: round(found.covered, 2) } : {}),
            }
          : null,
    };
  };

  const groups = all.map(facts);
  return {
    groups: only ? groups.filter((_, index) => all[index]!.items.some((item) => only.has(item.id))) : groups,
    unplaced: groups.filter((group) => group.placedBy === 'nobody').map((group) => group.group),
    system: systemLine(groups),
    reading: readingFact(canvas),
    platformsNote: platformAreas(canvas)
      ? 'coveredBy uses provisional areas, never matched to the apps.'
      : 'coveredBy is not known for a video that is not 9:16.',
  };
}
