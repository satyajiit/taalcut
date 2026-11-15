// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Assembly (P2-M4, SPEC "Assembly"): template + one cast variant → a
 * timeline. Each slot becomes a clip exactly the slot's length at the slot's
 * position, so every cut is the template's beat-anchored cut; transitions come
 * from the template, clamped to the media's handles; each overlay becomes a
 * text item, rewritten by the Editor when it gave text. The music is the
 * reel's own (render path d) when the template keeps its reel with sound
 * (REF1), and platform sound otherwise. On a canvas of another shape than the
 * template's (the clips', BRK1-MAKE) the overlays are fitted to it
 * (fit-layout.ts), and every overlay is placed by the reel's relation, not
 * its coordinates (FRM1-OVL, placement/). KEEP1: a slot the template states as
 * the reel's own footage is filled from the template's kept reel, and the
 * overlays over it are not drawn again (reel-footage.ts). MATCH1: where the
 * reel dissolved or faded between that footage and a slot the person's clip
 * fills, the kept clip is cut clear of the blended frames and the transition
 * is drawn again (reel-transitions.ts). Pure.
 */
import {
  DEFAULT_MIX,
  err,
  keepsReelFootage,
  ok,
  TIMELINE_SCHEMA_VERSION,
  type CastId,
  type Clip,
  type Marker,
  type MediaRef,
  type ProjectId,
  type Result,
  type SequenceItem,
  type SlotCast,
  type Template,
  type TemplateSlot,
  type Timeline,
  type TimelineId,
  type TimelineItemId,
} from '@taalcut/core';
import type { CastVariant } from '../casting/result';
import { MediaMissing, MediaTooShort, ReelMissing } from '../errors';
import { candidateKey } from '../model/cast';
import { marker, MARKER_LABELS } from '../model/markers';
import { positions } from '../model/sequence';
import { clipMediaFits, gentlerRamp } from '../model/speed';
import { checkEdited } from '../model/validate';
import { fitTransitions } from '../resync/neighbours';
import { resync } from '../resync/resync';
import { fitTextTracks } from './fit-layout';
import { reelTextLayout } from './placement/place-timeline';
import { textTracksFor } from './text';
import { compositionsUsed } from './designed';
import { reelCast, withoutReelOverlays, type ReelMedia } from './reel-footage';
import { isBlended, reelEdges, reelItems } from './reel-transitions';

export interface AssembleInput {
  readonly projectId: ProjectId;
  readonly template: Template;
  readonly variant: CastVariant;
  readonly cast: {
    readonly castId: CastId;
    readonly mode: 'template' | 'story';
    readonly variantIndex: number;
    readonly variantCount: number;
    readonly configVersion: string;
  };
  /** Output size; the rate is always the template's. Default: the template's canvas (the cast's, BRK1-MAKE). */
  readonly canvas?: { readonly width: number; readonly height: number };
  /**
   * FRM1-SUB: each video asset's frame aspect (width / height), by asset id. A clip whose aspect differs from the
   * canvas's by more than 1% follows its subject (`reframe: auto`, render SPEC P3.2); unknown aspects stay `null`.
   */
  readonly aspects?: ReadonlyMap<string, number>;
  /** The Editor's text for the user's footage, by overlay id. */
  readonly texts?: Readonly<Record<string, string>>;
  /**
   * REF1: the template keeps its reel with sound, so the music is the reel's own, from frame 0 where the beat
   * map starts. Default false: platform sound.
   */
  readonly keptAudio?: boolean;
  /**
   * KEEP1: the template's kept reel as a library asset (reel-footage.ts `reelMedia`), which fills each slot the
   * template states as the reel's own footage. A template with such a slot and no reel here is refused.
   */
  readonly reel?: ReelMedia;
  readonly timelineId: TimelineId;
  readonly name: string;
  /** Epoch ms for createdAt and updatedAt. */
  readonly now: number;
}

export interface AssembleIds {
  item(): TimelineItemId;
}

/** Render's reframe tolerance (reframe/config.ts `aspectTolerance`): within it, the aspects need no crop. */
export const REFRAME_ASPECT_TOLERANCE = 0.01;

/** `auto` when the clip's aspect differs from the canvas's by more than the tolerance (render SPEC P3.2). */
export function reframeFor(
  aspect: number | undefined,
  canvas: { width: number; height: number },
): Clip['reframe'] {
  if (aspect === undefined || !(aspect > 0)) return null;
  const differs = Math.abs(aspect / (canvas.width / canvas.height) - 1) > REFRAME_ASPECT_TOLERANCE;
  return differs ? { mode: 'auto', nudge: { x: 0, y: 0 }, scale: 1 } : null;
}

function clipFor(
  slot: TemplateSlot,
  cast: SlotCast,
  media: MediaRef,
  template: Template,
  id: TimelineItemId,
  reframe: Clip['reframe'],
): Result<Clip> {
  const pick = cast.pick;
  if (!pick) throw new Error('clipFor needs a pick');
  const clip: Clip = {
    type: 'clip',
    id,
    media,
    sourceStart: pick.sourceStart,
    duration: slot.duration,
    speed: slot.speedRamp,
    slotId: slot.id,
    syncPoint: media.kind === 'image' ? null : pick.syncPoint,
    beatAnchor: template.beatMap ? slot.beatAnchor : null,
    fit: 'cover',
    // Original sound is muted: the music paths (P2-M10) decide what plays.
    audio: { gainDb: 0, muted: true },
    locked: cast.note === 'userPick',
    enabled: true,
    stillMotion: null,
    reframe: media.kind === 'video' ? reframe : null,
  };
  if (clipMediaFits(clip, template.canvas.rate)) return ok(clip);
  if (media.kind !== 'image' && clip.speed) {
    // A shot too short for the ramp gets a gentler ramp, never media past its end.
    const gentler = { ...clip, speed: gentlerRamp(clip, media.available, template.canvas.rate) };
    if (clipMediaFits(gentler, template.canvas.rate)) return ok(gentler);
  }
  return err(MediaTooShort({ clipId: id }));
}

export function assemble(input: AssembleInput, ids: AssembleIds): Result<Timeline> {
  const { template, variant } = input;
  const rate = template.canvas.rate;
  const canvas = { ...template.canvas, ...(input.canvas ?? {}) };
  const media = new Map(
    variant.media.map((ref) => [
      candidateKey({ assetId: ref.assetId, shotId: ref.kind === 'video' ? ref.shotId : null }),
      ref,
    ]),
  );
  const casts = new Map(variant.slots.map((slot) => [slot.slotId as string, slot]));
  const items: SequenceItem[] = [];
  const slots: SlotCast[] = [];
  const markers: Marker[] = [];
  for (const [index, slot] of template.slots.entries()) {
    // KEEP1: the reel's own footage, cut from the template's reel; casting chose nothing here.
    if (keepsReelFootage(slot)) {
      if (!input.reel) return err(ReelMissing({ templateId: template.id }));
      const id = ids.item();
      // MATCH1: clear of the frames the reel blended with the person's side, the transition drawn again.
      const edges = reelEdges(template, index);
      const ownIds = { clip: id, item: ids.item };
      items.push(...reelItems(slot, input.reel, template, edges, ownIds, items.at(-1)?.type === 'clip'));
      slots.push(reelCast(slot, id, input.reel, edges.lead));
      continue;
    }
    const cast = casts.get(slot.id) ?? {
      slotId: slot.id,
      clipId: null,
      pick: null,
      alternates: [],
      confidence: null,
      needsRerank: false,
      note: 'noCandidates' as const,
    };
    const id = ids.item();
    const pick = cast.pick;
    if (!pick) {
      items.push({ type: 'gap', id, duration: slot.duration, slotId: slot.id });
      slots.push({ ...cast, clipId: null });
      continue;
    }
    const ref = media.get(candidateKey(pick));
    if (!ref) return err(MediaMissing({ assetId: pick.assetId }));
    // KEEP1: after the reel's own footage the cut is the reel's, already in its picture: no transition on top.
    // MATCH1: unless the reel blended the two there and the kept clip ends in its held last clean frame.
    const afterReel = index > 0 && keepsReelFootage(template.slots[index - 1]!);
    const last = items.at(-1);
    const redrawn = isBlended(slot) && last?.type === 'clip' && last.holdFrame !== undefined;
    const transition = afterReel && !redrawn ? null : slot.transitionIn;
    if (transition && index > 0 && items.at(-1)?.type === 'clip')
      items.push({
        type: 'transition',
        id: ids.item(),
        kind: transition.kind,
        inOffset: transition.before,
        outOffset: transition.after,
        direction: transition.direction,
      });
    else if (transition && index > 0)
      markers.push(marker(ids.item(), 'note', MARKER_LABELS.noHandle, slot.start.value, 1, rate));
    const clip = clipFor(slot, cast, ref, template, id, reframeFor(input.aspects?.get(ref.assetId), canvas));
    if (!clip.ok) return clip;
    items.push(clip.value);
    slots.push({ ...cast, clipId: id });
    if (clip.value.beatAnchor && clip.value.syncPoint === null && ref.kind === 'video')
      markers.push(marker(ids.item(), 'qa', MARKER_LABELS.noSyncPoint, slot.start.value, 1, rate));
  }
  // A transition beside a gap, or with no media to overlap, becomes a plain cut and a note.
  const fitted = fitTransitions(items, rate);
  const kept = new Set(fitted.map((item) => item.id));
  const starts = new Map(positions(items).map((position) => [position.itemIndex, position.start]));
  items.forEach((item, index) => {
    if (item.type !== 'transition' || kept.has(item.id)) return;
    const start = starts.get(index + 1) ?? 0;
    markers.push(marker(ids.item(), 'note', MARKER_LABELS.noHandle, start, 1, rate));
  });
  const hookEnd = Math.min(template.pacing.hookEnd.value, template.duration.value);
  if (hookEnd > 0) markers.push(marker(ids.item(), 'hook', MARKER_LABELS.hook, 0, hookEnd, rate));

  // KEEP1: only the overlays over the person's clips become items; the reel's footage has its own burned in.
  const overlaid = withoutReelOverlays(template);
  const textTracks = fitTextTracks(textTracksFor(overlaid, input.texts ?? {}, ids), template.canvas, canvas);
  const graphics = textTracks.flatMap((track) => track.items.filter((item) => item.type === 'graphic'));
  // HFW1: the compositions they draw with, copied once each (their files go into the project: cast-tools.ts).
  const graphicCompositions = compositionsUsed(template, graphics);
  const timeline: Timeline = {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: input.timelineId,
    projectId: input.projectId,
    name: input.name,
    revision: 1,
    canvas,
    template: { id: template.id, version: template.version },
    beatMap: template.beatMap,
    tracks: [{ kind: 'video', id: 'V1', name: 'V1', enabled: true, items: fitted }, ...textTracks],
    markers,
    cast: {
      castId: input.cast.castId,
      mode: input.cast.mode,
      variantIndex: input.cast.variantIndex,
      variantCount: input.cast.variantCount,
      configVersion: input.cast.configVersion,
      sequenceConfidence: variant.sequenceConfidence,
      slots,
    },
    captions: null,
    music: input.keptAudio
      ? { path: 'referenceAudio', templateId: template.id, gainDb: 0 }
      : { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    ...(graphicCompositions.length > 0 ? { graphicCompositions } : {}),
    createdAt: input.now,
    updatedAt: input.now,
  };
  // TXT1: the text starts where the reel had it, a run together at one place and one size. No code moves it from
  // there (FRM1-OVL's solver did): whoever makes the video places it (timeline.placeText).
  const placed = reelTextLayout({ timeline, template });
  // A no-op on a fresh assembly (tested): every cut is already the template's.
  return checkEdited(resync(placed, { moved: [] }));
}
