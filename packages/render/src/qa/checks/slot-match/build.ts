// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: QaFacts.slotMatch from what the export has. Each template slot gets its clips on the draft (V1 by
 * slot id, their cuts in output frames), the library's word on their shots (timeline's `slotShots`, through the
 * render root), their subject samples on the canvas (the heads stage's, so a reframed clip is read through its crop),
 * and the reel's own subjects over the slot. Each reel graphic gets the draft graphic that draws it. Pure.
 */
import {
  RationalTime,
  reelSubjectsDuring,
  type CameraMotion,
  type GraphicItem,
  type Rect,
  type Template,
  type TemplateSlot,
  type Timeline,
} from '@taalcut/core';
import type { NeedVerdict, SlotShot } from '@taalcut/timeline';
import type { ClipHeads } from '../../../engine/stages/heads';
import type { FrameSpan, PlannedComposition, PlannedVisual } from '../../../plan/types';
import { drawnOverlay } from '../../../workspace/designer/reel-match';
import { graphicOverlays, overlayBrief } from '../../../workspace/template/brief';
import type { ShareBox, SlotFact, SlotGraphicFact, SlotMatchFact } from './facts';

export interface SlotMatchBuildInput {
  readonly timeline: Timeline;
  readonly template: Template;
  readonly shots: readonly SlotShot[];
  readonly plan: {
    readonly width: number;
    readonly height: number;
    readonly rate: { readonly num: number; readonly den: number };
    readonly visuals: readonly Pick<PlannedVisual, 'id' | 'cut' | 'enabled' | 'slotId'>[];
    readonly compositions?: readonly Pick<PlannedComposition, 'itemId' | 'span' | 'values'>[];
  };
  /** Each tracked clip's samples on the canvas (the heads stage's `byClip`). */
  readonly heads: readonly ClipHeads[];
}

const area = (box: { readonly width: number; readonly height: number }) => box.width * box.height;
const largest = <B extends { readonly width: number; readonly height: number }>(boxes: readonly B[]) =>
  boxes.reduce<B | null>((best, box) => (!best || area(box) > area(best) ? box : best), null);

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The middle box of a run of boxes: each side's median. */
function medianBox(boxes: readonly ShareBox[]): ShareBox | null {
  if (boxes.length === 0) return null;
  return {
    x: medianOf(boxes.map((box) => box.x)),
    y: medianOf(boxes.map((box) => box.y)),
    width: medianOf(boxes.map((box) => box.width)),
    height: medianOf(boxes.map((box) => box.height)),
  };
}

/** The reel's main head over a slot (the largest head on each sample), as shares of its canvas. */
function reelHead(template: Template, slot: TemplateSlot): ShareBox | null {
  if (!template.subjects) return null;
  const samples = reelSubjectsDuring(template.subjects, slot.start, slot.duration);
  return medianBox(samples.flatMap((sample) => largest(sample.heads.map((head) => head.box)) ?? []));
}

/** The slot's needs over its clips: each met when one of them meets it, its others the most any counts. */
function mergedNeeds(shots: readonly SlotShot[]): NeedVerdict[] {
  const first = shots[0];
  if (!first) return [];
  return first.needs.map((need, index) => {
    const all = shots.map((shot) => shot.needs[index]).filter((entry): entry is NeedVerdict => !!entry);
    const met = all.find((entry) => entry.met);
    return {
      text: need.text,
      met: !!met,
      by: met?.by ?? null,
      others: Math.max(...all.map((entry) => entry.others)),
    };
  });
}

/** The slot's camera move: what its intent says, else what was measured. */
const reelMotion = (slot: TemplateSlot): CameraMotion | null =>
  (slot.intent.source === 'pending' ? null : slot.intent.motion) ?? slot.motionMeasure?.label ?? null;

function slotFact(input: SlotMatchBuildInput, slot: TemplateSlot, index: number): SlotFact {
  const { plan } = input;
  const seconds = (frames: number) => (frames * plan.rate.den) / plan.rate.num;
  const visuals = plan.visuals.filter((visual) => visual.enabled && visual.slotId === slot.id);
  const ids = new Set(visuals.map((visual) => visual.id));
  const v1 = input.timeline.tracks[0];
  const filler =
    v1?.kind === 'video'
      ? v1.items.find((item) => item.type !== 'transition' && item.slotId === slot.id)
      : undefined;
  const span: FrameSpan | null =
    visuals.length > 0
      ? {
          start: Math.min(...visuals.map((v) => v.cut.start)),
          end: Math.max(...visuals.map((v) => v.cut.end)),
        }
      : null;
  const clips = input.heads.filter((clip) => ids.has(clip.id));
  const inCut = clips.flatMap((clip) =>
    clip.samples.filter((sample) => sample.frame >= clip.cut.start && sample.frame < clip.cut.end),
  );
  const toShare = (rect: Rect): ShareBox => ({
    x: rect.x / plan.width,
    y: rect.y / plan.height,
    width: rect.width / plan.width,
    height: rect.height / plan.height,
  });
  const shots = input.shots.filter((shot) => ids.has(shot.clipId));
  return {
    slotId: slot.id,
    number: index + 1,
    target: visuals[0]?.id ?? filler?.id ?? slot.id,
    clipId: visuals[0]?.id ?? null,
    span,
    reelSeconds: RationalTime.toSeconds(slot.duration),
    draftSeconds: visuals.reduce((sum, visual) => sum + seconds(visual.cut.end - visual.cut.start), 0),
    needs: mergedNeeds(shots),
    face: {
      wanted: slot.intent.source === 'pending' ? null : (slot.intent.face ?? null),
      samples: inCut.length,
      shown: inCut.filter((sample) => sample.face).length,
    },
    framing: {
      reel: reelHead(input.template, slot),
      draft: medianBox(inCut.flatMap((sample) => largest(sample.heads.map(toShare)) ?? [])),
      measured: clips.length > 0,
    },
    motion: { reel: reelMotion(slot), shot: shots[0]?.motion ?? null },
  };
}

function graphicItems(timeline: Timeline): GraphicItem[] {
  return timeline.tracks.flatMap((track) =>
    track.kind === 'text'
      ? track.items.filter((item): item is GraphicItem => item.type === 'graphic' && !item.proposal)
      : [],
  );
}

function graphicFacts(input: SlotMatchBuildInput, slots: readonly SlotFact[]): SlotGraphicFact[] {
  const items = graphicItems(input.timeline);
  return graphicOverlays(input.template).flatMap((overlay): SlotGraphicFact[] => {
    const brief = overlayBrief(input.template, overlay);
    if (!brief) return [];
    const slot = slots.find((entry) => entry.slotId === overlay.slotId);
    const item = items.find((candidate) => candidate.overlay?.id === overlay.id);
    const placed = item ? input.plan.compositions?.find((entry) => entry.itemId === item.id) : undefined;
    const span = placed?.span ?? null;
    return [
      {
        overlayId: overlay.id,
        slotId: overlay.slotId,
        number: slot?.number ?? null,
        brief,
        itemId: placed ? item!.id : null,
        span,
        hold: span ? Math.floor((span.start + Math.max(span.start, span.end - 1)) / 2) : null,
        wordsRatio: placed ? drawnOverlay([brief], placed.values).wordsRatio : 1,
      },
    ];
  });
}

export function slotMatchFact(input: SlotMatchBuildInput): SlotMatchFact {
  const slots = input.template.slots.map((slot, index) => slotFact(input, slot, index));
  return {
    canvas: { width: input.plan.width, height: input.plan.height },
    slots,
    graphics: graphicFacts(input, slots),
  };
}
