// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A Style's intro and outro around a timeline (P3-V10, SPEC P3.5). Rather than teach every stage about
 * bumpers, the export renders a copy of the timeline with them in place: a clip bumper is a locked V1 clip
 * (conformed like any clip), a card bumper is a V1 gap the brand layer draws over, and everything timed
 * after the intro (text, graphics, captions, markers, audio tracks, beats) moves by its length. The stored
 * timeline never changes. On path a (platform sound) the intro is left out: the platform's sound must start
 * at the timeline's frame 0.
 */
import {
  RationalTime,
  type AssetId,
  type CaptionTrack,
  type Clip,
  type FrameRate,
  type Gap,
  type Result,
  type Timeline,
  type TimeRange,
  type TimelineItemId,
} from '@taalcut/core';
import { ok } from '@taalcut/core';
import { stableId } from '../ids/stable-id';
import { toFrame } from '../time/frames';
import { NO_BUMPERS, type PlannedBumpers, type PlannedCard } from '../plan/types';

/** A bumper as the export resolved it: a clip's source range is known (probed when the Style gave none). */
export type ResolvedBumper =
  | { readonly kind: 'clip'; readonly assetId: AssetId; readonly range: TimeRange }
  | {
      readonly kind: 'card';
      readonly text: string;
      /** The card's length at any rate (Style v1, contract P3-2); placed at the timeline's rate once. */
      readonly duration: RationalTime;
      readonly background: PlannedCard['background'];
    };

export interface BumperInput {
  readonly intro: ResolvedBumper | null;
  readonly outro: ResolvedBumper | null;
  /** Bumper clips whose asset is gone (skipped, with a brandAssets warning). */
  readonly missing: readonly ('intro' | 'outro')[];
}

function framesOf(bumper: ResolvedBumper, rate: FrameRate): number {
  if (bumper.kind === 'card') return Math.max(1, RationalTime.toFrames(bumper.duration, rate));
  return Math.max(1, toFrame(bumper.range.duration, rate));
}

function bumperItem(bumper: ResolvedBumper, id: TimelineItemId, rate: FrameRate): Clip | Gap {
  const duration = RationalTime.of(framesOf(bumper, rate), rate);
  if (bumper.kind === 'card') return { type: 'gap', id, duration, slotId: null };
  return {
    type: 'clip',
    id,
    media: { kind: 'video', assetId: bumper.assetId, shotId: null, available: bumper.range },
    sourceStart: bumper.range.start,
    duration,
    speed: null,
    slotId: null,
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: 0, muted: false },
    locked: true,
    enabled: true,
    stillMotion: null,
    reframe: null,
  };
}

const later = (time: RationalTime, by: RationalTime) => RationalTime.add(time, by);

function shiftCaptions(track: CaptionTrack | null, by: RationalTime): CaptionTrack | null {
  if (!track) return null;
  return {
    ...track,
    cues: track.cues.map((cue) => ({
      ...cue,
      range: { ...cue.range, start: later(cue.range.start, by) },
      words: cue.words.map((word) => ({
        ...word,
        range: { ...word.range, start: later(word.range.start, by) },
      })),
    })),
  };
}

/** The timeline with its bumpers in place, and where they sit on the render. */
export function withBumpers(
  timeline: Timeline,
  input: BumperInput,
): Result<{ timeline: Timeline; bumpers: PlannedBumpers }> {
  const rate = timeline.canvas.rate;
  const platformSound = timeline.music.path === 'platformSound';
  const intro = platformSound ? null : input.intro;
  const introLeftOut = platformSound && input.intro !== null;
  const outro = input.outro;
  if (!intro && !outro)
    return ok({ timeline, bumpers: { ...NO_BUMPERS, introLeftOut, missing: input.missing } });
  const ids = {
    intro: stableId<'TimelineItem'>(`${timeline.id}:intro`),
    outro: stableId<'TimelineItem'>(`${timeline.id}:outro`),
    lead: stableId<'TimelineItem'>(`${timeline.id}:lead`),
  };
  if (!ids.intro.ok) return ids.intro;
  if (!ids.outro.ok) return ids.outro;
  if (!ids.lead.ok) return ids.lead;
  const introFrames = intro ? framesOf(intro, rate) : 0;
  const by = RationalTime.of(introFrames, rate);
  const leadId = ids.lead.value;
  const introItem = intro ? bumperItem(intro, ids.intro.value, rate) : null;
  const outroItem = outro ? bumperItem(outro, ids.outro.value, rate) : null;
  const v1 = timeline.tracks.findIndex((track) => track.kind === 'video');
  const tracks = timeline.tracks.map((track, index) => {
    if (track.kind === 'text')
      return { ...track, items: track.items.map((item) => ({ ...item, start: later(item.start, by) })) };
    if (index === v1)
      return {
        ...track,
        items: [...(introItem ? [introItem] : []), ...track.items, ...(outroItem ? [outroItem] : [])],
      };
    if (introFrames === 0) return track;
    const lead: Gap = { type: 'gap', id: leadId, duration: by, slotId: null };
    return { ...track, items: [lead, ...track.items] };
  });
  const timelineFrames =
    timeline.tracks[v1]?.items.reduce(
      (sum, item) => sum + (item.type === 'transition' ? 0 : toFrame(item.duration, rate)),
      0,
    ) ?? 0;
  const outroFrames = outro ? framesOf(outro, rate) : 0;
  const introSpan = intro ? { start: 0, end: introFrames } : null;
  const outroSpan = outro
    ? { start: introFrames + timelineFrames, end: introFrames + timelineFrames + outroFrames }
    : null;
  const cards: PlannedCard[] = [];
  if (intro?.kind === 'card' && introSpan)
    cards.push({ id: 'intro', span: introSpan, text: intro.text, background: intro.background });
  if (outro?.kind === 'card' && outroSpan)
    cards.push({ id: 'outro', span: outroSpan, text: outro.text, background: outro.background });
  return ok({
    timeline: {
      ...timeline,
      tracks,
      captions: shiftCaptions(timeline.captions, by),
      markers: timeline.markers.map((marker) => ({
        ...marker,
        range: { ...marker.range, start: later(marker.range.start, by) },
      })),
      beatMap: timeline.beatMap
        ? { ...timeline.beatMap, beats: timeline.beatMap.beats.map((beat) => later(beat, by)) }
        : null,
    },
    bumpers: { intro: introSpan, outro: outroSpan, cards, introLeftOut, missing: input.missing },
  });
}
