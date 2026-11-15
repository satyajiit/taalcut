// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: a run of texts is placed as one. The owner's lyric, seven words shown one after another at one place in
 * the reel, was solved a word at a time: each word cleared the heads of its own clip, so the line wandered between
 * 42 % and 62 % of the height and its centre drifted sideways.
 *
 * A run is the breakdown's own sequence (LYR1, templates' `templateTextSequences`, read here from the stored
 * overlays): texts on one line, one mostly inside the other's width, of one size, each starting where the last
 * ended. Nothing here reads what the words say. The made items of one run are one unit: one box, as wide and as
 * tall as the run's largest text, at the run's one size (`runSizes`), and each text sits in that box the way the
 * reel set them: centred on one line, or flush to the edge they shared. The unit starts where the reel had the run
 * (place-timeline.ts `reelTextLayout`); whoever places it later places the unit (styles/place-text.ts). The solver sees
 * the unit as one item too, over every clip the run crosses, for the candidate it reports. A text a person placed
 * is theirs and stays out of it. Pure.
 */
import type { OverlayPlacement, PlacementReason, Template, TextTrackItem } from '@taalcut/core';
import { templateTextSequences } from '@taalcut/templates';
import { centreX, centreY, right, type Rect, type Size } from './geometry';
import { reelTextSize, TEXT_HALO, type Owned, type Surface } from './place-items';
import type { PlacementItem } from './types';

type Align = 'left' | 'center' | 'right';

/** What the solver places: one text, or a run of them as one box. */
export interface PlacedUnit {
  readonly request: PlacementItem;
  readonly members: readonly Owned[];
  /** Every member with the unit's box, scale and reason. */
  apply(box: Rect, scale: number, reason: PlacementReason): TextTrackItem[];
}

const overlayIdOf = (item: TextTrackItem) =>
  item.type === 'text' ? item.overlayId : (item.overlay?.id ?? null);

/** The template's runs, as sets of overlay ids. */
export function runsOf(template: Pick<Template, 'text' | 'canvas'>): readonly (readonly string[])[] {
  return templateTextSequences(template).map((sequence) => sequence.ids as readonly string[]);
}

/** The ids of every item that shares a run with one of `ids` (those items included). */
export function runMates(
  items: readonly TextTrackItem[],
  template: Pick<Template, 'text' | 'canvas'>,
  ids: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const run of runsOf(template)) {
    const members = items.filter((item) => {
      const overlayId = overlayIdOf(item);
      return overlayId !== null && run.includes(overlayId);
    });
    if (members.some((item) => ids.has(item.id))) for (const item of members) out.add(item.id);
  }
  return out;
}

const median = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] ?? 0;

/** A run's one size, by overlay id: the middle of the reel's own sizes for its texts, on the made canvas. */
export function runSizes(template: Pick<Template, 'text' | 'canvas'>, surface: Surface): Map<string, number> {
  const byId = new Map(template.text.map((overlay) => [overlay.id as string, overlay]));
  const sizes = new Map<string, number>();
  for (const run of runsOf(template)) {
    const size = median(run.flatMap((id) => (byId.has(id) ? [reelTextSize(byId.get(id)!, surface)] : [])));
    for (const id of run) sizes.set(id, size);
  }
  return sizes;
}
const spread = (values: readonly number[]) => Math.max(...values) - Math.min(...values);

/** How the reel set the run's texts against each other: the edge (or the centre) that moved least between them. */
export function runAlign(reels: readonly Rect[]): Align {
  const centre = spread(reels.map(centreX));
  const left = spread(reels.map((rect) => rect.x));
  const rightEdge = spread(reels.map(right));
  // The centre wins a tie: one word after another in the middle of the frame is the common case.
  if (centre <= left && centre <= rightEdge) return 'center';
  return left <= rightEdge ? 'left' : 'right';
}

/** The relation most of the run's texts had in the reel (the first of them on a tie), its gap their median. */
function runRelation(relations: readonly OverlayPlacement[]): OverlayPlacement {
  const key = (relation: OverlayPlacement) =>
    `${relation.relativeTo}:${relation.side ?? ''}:${relation.zone}`;
  const counts = new Map<string, number>();
  for (const relation of relations) counts.set(key(relation), (counts.get(key(relation)) ?? 0) + 1);
  let best = relations[0]!;
  for (const relation of relations)
    if ((counts.get(key(relation)) ?? 0) > (counts.get(key(best)) ?? 0)) best = relation;
  const gaps = relations.flatMap((relation) =>
    key(relation) === key(best) && relation.gap !== undefined ? [relation.gap] : [],
  );
  return gaps.length > 0 ? { ...best, gap: median(gaps) } : best;
}

function soloUnit(owned: Owned): PlacedUnit {
  return {
    request: owned.request,
    members: [owned],
    apply: (box, scale, reason) => [owned.apply(box, scale, reason)],
  };
}

function runUnit(members: readonly Owned[]): PlacedUnit {
  const reels = members.map((member) => member.reelBox);
  const align = runAlign(reels);
  const sizeAt = (scale: number): Size => {
    const sizes = members.map((member) => member.request.sizeAt(scale));
    return {
      width: Math.max(...sizes.map((size) => size.width)),
      height: Math.max(...sizes.map((size) => size.height)),
    };
  };
  const full = sizeAt(1);
  // The reel's anchor for the run: the median of where its texts sat, on the edge they shared (a text's footprint
  // reaches TEXT_HALO past its words).
  const anchorX =
    align === 'left'
      ? median(reels.map((rect) => rect.x)) - TEXT_HALO
      : align === 'right'
        ? median(reels.map(right)) + TEXT_HALO - full.width
        : median(reels.map(centreX)) - full.width / 2;
  const spans = members.map((member) => member.request.span);
  const request: PlacementItem = {
    id: `run:${members[0]!.request.id}`,
    span: {
      start: Math.min(...spans.map((span) => span.start)),
      end: Math.max(...spans.map((span) => span.end)),
    },
    sizeAt,
    minScale: Math.max(...members.map((member) => member.request.minScale)),
    relation: runRelation(members.map((member) => member.request.relation)),
    reel: { x: anchorX, y: median(reels.map(centreY)) - full.height / 2, ...full },
    onPicture: members.some((member) => member.request.onPicture),
    together: members.length,
  };
  return {
    request,
    members,
    apply: (box, scale, reason) =>
      members.map((member) => {
        const size = member.request.sizeAt(scale);
        const x =
          align === 'left'
            ? box.x
            : align === 'right'
              ? box.x + box.width - size.width
              : box.x + (box.width - size.width) / 2;
        const placed = member.apply({ x, y: box.y + (box.height - size.height) / 2, ...size }, scale, reason);
        // Each text is set in its own box the way the boxes are set in the run's, so the words line up too.
        return placed.type === 'text' ? { ...placed, appearance: { ...placed.appearance, align } } : placed;
      }),
  };
}

/**
 * The owned items as the solver's units: every run with two or more of its texts among them as one, the rest each
 * on its own.
 */
export function placedUnits(
  owned: readonly Owned[],
  template: Pick<Template, 'text' | 'canvas'>,
): PlacedUnit[] {
  const byOverlay = new Map<string, Owned>();
  for (const entry of owned) {
    const overlayId = overlayIdOf(entry.item);
    if (overlayId) byOverlay.set(overlayId, entry);
  }
  const grouped = new Set<Owned>();
  const units: PlacedUnit[] = [];
  for (const run of runsOf(template)) {
    const members = run.flatMap((id) => byOverlay.get(id) ?? []);
    if (members.length < 2) continue;
    for (const member of members) grouped.add(member);
    units.push(runUnit(members));
  }
  for (const entry of owned) if (!grouped.has(entry)) units.push(soloUnit(entry));
  return units;
}
