// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: assembling a slot that keeps the reel's own footage (core's slot-footage.ts). The tools fill it, not the
 * model's hands: its clip plays the template's kept reel (REF1) at the slot's exact frame range, in real time, whole
 * in the frame as the reel showed it.
 *
 * - Media: the reel is one library asset (cast-tools.ts puts it there once, through the port in tools/reel-source.ts);
 *   the clip is a cut of it, `sourceStart` the slot's start. The template's frames are counted on the reel at the
 *   canvas rate, so the slot's range is the same range of the reel, and no frame is encoded again.
 * - Picture: `fit: 'contain'` with no reframe, never a crop that follows a subject. A reel analysed from a screen
 *   recording is cropped to the reel's rectangle the breakdown found (the template's `origin.crop`).
 * - Time: no speed ramp. Between two kept slots, and at a whip, no transition of the template's either: the reel's
 *   own is already in its picture, and a transition's handles would show the reel's neighbouring shot. MATCH1: a
 *   dissolve or a fade between a kept slot and one the person's clip fills is different: the reel's frames there
 *   hold the creator's footage too, so the kept clip is cut clear of them and the transition is drawn again
 *   (reel-transitions.ts).
 * - Sound: muted, like every clip. While the music is the reel's own (the default when the template keeps its reel
 *   with sound) the slot's sound, film dialogue included, plays from the reel's audio at the same instant, because
 *   the slot sits where it sat in the reel.
 * - Cast: the slot's note is `reelKept`, with the reel as its pick and no confidence, so nothing reads it as an
 *   unsure pick or a gap.
 * - Overlays: words and graphics the reel burned into its picture are not drawn a second time (`withoutReelOverlays`).
 */
import {
  keepsReelFootage,
  RationalTime,
  TimeRange,
  type AssetId,
  type Clip,
  type MediaRef,
  type SlotCast,
  type Template,
  type TemplateSlot,
  type TimelineItemId,
} from '@taalcut/core';
import { manualCandidate } from '../model/cast';

/** The template's kept reel as media a clip plays. */
export type ReelMedia = Extract<MediaRef, { kind: 'video' }>;

/** The reel as clip media: the whole of what the template's frames are counted on. */
export function reelMedia(template: Template, assetId: AssetId): ReelMedia {
  const rate = template.canvas.rate;
  return {
    kind: 'video',
    assetId,
    shotId: null,
    available: TimeRange.of(RationalTime.zero(rate), template.duration),
  };
}

/** The reel's rectangle inside a screen recording, as the one region of the clip's layout; none for a plain reel. */
function reelLayout(template: Template): Pick<Clip, 'visualLayout'> {
  if (template.origin.kind !== 'reference' || !template.origin.crop) return {};
  const { crop, source } = template.origin;
  const share = (value: number, of: number) => Math.min(1, Math.max(0, value / of));
  const x = share(crop.x, source.width);
  const y = share(crop.y, source.height);
  return {
    visualLayout: {
      regions: [
        {
          id: 'reel',
          viewport: { x: 0, y: 0, width: 1, height: 1 },
          fit: 'contain',
          keyframes: [
            {
              at: RationalTime.zero(template.canvas.rate),
              crop: {
                x,
                y,
                width: Math.min(1 - x, share(crop.width, source.width)),
                height: Math.min(1 - y, share(crop.height, source.height)),
              },
            },
          ],
        },
      ],
    },
  };
}

/** The clip of a slot that keeps the reel's footage: the reel from the slot's start, for the slot's length. */
export function reelClip(slot: TemplateSlot, media: ReelMedia, template: Template, id: TimelineItemId): Clip {
  return {
    type: 'clip',
    id,
    media,
    sourceStart: slot.start,
    duration: slot.duration,
    speed: null,
    slotId: slot.id,
    syncPoint: null,
    beatAnchor: template.beatMap ? slot.beatAnchor : null,
    fit: 'contain',
    audio: { gainDb: 0, muted: true },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
    ...reelLayout(template),
  };
}

/**
 * The cast of that slot: the reel as its pick, by the template's statement, never unsure and never a gap. `lead` is
 * how far into the slot its clip starts (MATCH1: past the frames a transition blended).
 */
export function reelCast(slot: TemplateSlot, clipId: TimelineItemId, media: ReelMedia, lead = 0): SlotCast {
  const from = lead > 0 ? RationalTime.add(slot.start, RationalTime.of(lead, slot.start.rate)) : slot.start;
  return {
    slotId: slot.id,
    clipId,
    pick: manualCandidate({ assetId: media.assetId, shotId: null }, from, null),
    alternates: [],
    confidence: null,
    needsRerank: false,
    note: 'reelKept',
  };
}

interface Stretch {
  readonly start: number;
  readonly end: number;
}

/** The stretches of the template the person's clips fill, in canvas frames, neighbours joined. */
function personStretches(template: Template): Stretch[] {
  const out: Stretch[] = [];
  for (const slot of template.slots) {
    if (keepsReelFootage(slot)) continue;
    const start = slot.start.value;
    const end = start + slot.duration.value;
    const last = out.at(-1);
    if (last && last.end === start) out[out.length - 1] = { start: last.start, end };
    else out.push({ start, end });
  }
  return out;
}

/**
 * The template with only the overlays that show over the person's clips, each cut to its time there. An overlay
 * that lies wholly over reel slots is left out: the reel's picture already has it. One that runs across a boundary
 * keeps the stretch over the person's clips that holds its start, else the first one it reaches, when that stretch
 * is at least half its time; with less there it is mostly the reel's footage's own, and a few frames of it over the
 * person's clip would only flash. A template with no reel slot comes back as it is.
 */
export function withoutReelOverlays(template: Template): Template {
  if (!template.slots.some(keepsReelFootage)) return template;
  const stretches = personStretches(template);
  const rate = template.canvas.rate;
  const slotAt = (frame: number) =>
    template.slots.find(
      (slot) => slot.start.value <= frame && frame < slot.start.value + slot.duration.value,
    );
  const text = template.text.flatMap((overlay) => {
    const start = overlay.start.value;
    const end = start + overlay.duration.value;
    const shown = stretches.find((stretch) => stretch.end > start && stretch.start < end);
    if (!shown) return [];
    const from = Math.max(start, shown.start);
    const to = Math.min(end, shown.end);
    if (from === start && to === end) return [overlay];
    if ((to - from) * 2 < end - start) return [];
    return [
      {
        ...overlay,
        start: RationalTime.of(from, rate),
        duration: RationalTime.of(to - from, rate),
        slotId: overlay.slotId === null ? null : (slotAt(from)?.id ?? overlay.slotId),
      },
    ];
  });
  return text.length === template.text.length && text.every((item, index) => item === template.text[index])
    ? template
    : { ...template, text };
}
