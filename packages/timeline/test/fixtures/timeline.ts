// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Hand-built Timeline v1 documents for edit, re-sync and OTIO tests. */
import {
  DEFAULT_MIX,
  TIMELINE_SCHEMA_VERSION,
  type FrameRate,
  FrameRates,
  newId,
  RationalTime,
  TimeRange,
  timelineSchema,
  type CastCandidate,
  type Clip,
  type SequenceItem,
  type SlotCast,
  type SlotId,
  type TextItem,
  type Timeline,
  type TimelineItemId,
  type TRANSITION_KINDS,
} from '@taalcut/core';

export interface ClipDef {
  readonly frames: number;
  readonly gap?: boolean;
  readonly image?: boolean;
  /** The asset's length in media frames (default 600) and its rate (default the canvas's). */
  readonly media?: number;
  readonly mediaRate?: FrameRate;
  /** Media frame of the in-point (default 100). */
  readonly sourceStart?: number;
  /** Media frame of the sync point; default the in-point; null for none. */
  readonly sync?: number | null;
  readonly locked?: boolean;
  readonly ramp?: readonly (readonly [number, number])[];
  /** A transition before this clip: [kind, inOffset, outOffset]. */
  readonly transition?: readonly [(typeof TRANSITION_KINDS)[number], number, number];
}

export interface TextDef {
  readonly start: number;
  readonly frames: number;
  readonly slot?: number;
  readonly track?: number;
}

export interface TimelineDef {
  readonly rate?: FrameRate;
  readonly clips: readonly ClipDef[];
  readonly beatEvery?: number;
  readonly beats?: boolean;
  readonly texts?: readonly TextDef[];
  readonly cast?: boolean;
}

export interface Built {
  readonly timeline: Timeline;
  /** Item ids by clip index (gaps included). */
  readonly ids: TimelineItemId[];
  readonly slots: SlotId[];
}

export function candidate(clip: Clip, score = 0.7): CastCandidate {
  return {
    assetId: clip.media.assetId,
    shotId: clip.media.kind === 'video' ? clip.media.shotId : null,
    sourceStart: clip.sourceStart,
    syncPoint: clip.syncPoint,
    score,
    parts: { intent: 0.7, motion: 1, quality: 0.8, subject: 0.5, energy: 0.9, hook: null, rerank: null, penalty: 0 },
  };
}

export function buildTimeline(def: TimelineDef): Built {
  const rate = def.rate ?? FrameRates.fps30;
  const at = (value: number, r: FrameRate = rate) => RationalTime.of(value, r);
  const beatEvery = def.beatEvery ?? 15;
  const total = def.clips.reduce((sum, clip) => sum + clip.frames, 0);
  const beats: number[] = [];
  for (let frame = 0; frame <= total + beatEvery * 4; frame += beatEvery) beats.push(frame);
  const withBeats = def.beats ?? true;
  const ids: TimelineItemId[] = [];
  const slots: SlotId[] = [];
  const items: SequenceItem[] = [];
  const castSlots: SlotCast[] = [];
  let start = 0;
  def.clips.forEach((clipDef) => {
    const id = newId<'TimelineItem'>();
    const slotId = newId<'TemplateSlot'>();
    ids.push(id);
    slots.push(slotId);
    if (clipDef.transition)
      items.push({
        type: 'transition',
        id: newId<'TimelineItem'>(),
        kind: clipDef.transition[0],
        inOffset: at(clipDef.transition[1]),
        outOffset: at(clipDef.transition[2]),
        direction: null,
      });
    if (clipDef.gap) {
      items.push({ type: 'gap', id, duration: at(clipDef.frames), slotId });
      castSlots.push({ slotId, clipId: null, pick: null, alternates: [], confidence: null, needsRerank: false, note: 'noCandidates' });
    } else {
      const mediaRate = clipDef.mediaRate ?? rate;
      const sourceStart = clipDef.sourceStart ?? 100;
      const beatIndex = beats.indexOf(start);
      const clip: Clip = {
        type: 'clip',
        id,
        media: clipDef.image
          ? { kind: 'image', assetId: newId<'Asset'>() }
          : {
              kind: 'video',
              assetId: newId<'Asset'>(),
              shotId: newId<'Shot'>(),
              available: TimeRange.of(at(0, mediaRate), at(clipDef.media ?? 600, mediaRate)),
            },
        sourceStart: clipDef.image ? at(0) : at(sourceStart, mediaRate),
        duration: at(clipDef.frames),
        speed: clipDef.ramp ? { curve: 'linear', points: clipDef.ramp.map(([frame, speed]) => ({ at: at(frame), speed })) } : null,
        slotId,
        syncPoint: clipDef.image || clipDef.sync === null ? null : at(clipDef.sync ?? sourceStart, mediaRate),
        beatAnchor: withBeats && beatIndex >= 0 ? { beatIndex, offset: at(0) } : null,
        fit: 'cover',
        audio: { gainDb: 0, muted: true },
        locked: clipDef.locked ?? false,
        enabled: true,
        stillMotion: null,
        reframe: null,
      };
      items.push(clip);
      castSlots.push({ slotId, clipId: id, pick: candidate(clip), alternates: [], confidence: 0.8, needsRerank: false, note: null });
    }
    start += clipDef.frames;
  });
  const textItems: TextItem[][] = [];
  for (const text of def.texts ?? []) {
    const track = text.track ?? 0;
    textItems[track] ??= [];
    textItems[track].push({
      type: 'text',
      id: newId<'TimelineItem'>(),
      start: at(text.start),
      duration: at(text.frames),
      text: 'Hello',
      role: 'title',
      slotId: text.slot === undefined ? null : (slots[text.slot] as SlotId),
      overlayId: null,
      box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
      appearance: { size: 0.05, align: 'center', case: 'mixed', background: 'none' },
      styleKey: 'title',
      reveal: 'none',
      language: 'en',
      origin: 'template',
    });
  }
  const timeline = timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Test',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate },
    template: null,
    beatMap: withBeats
      ? { rate, beats: beats.map((frame) => at(frame)), downbeats: [0], bpm: 120, beatsPerBar: 4, confidence: 1, source: 'tracker' }
      : null,
    tracks: [
      { kind: 'video', id: 'V1', name: 'V1', enabled: true, items },
      ...textItems.map((list, index) => ({ kind: 'text', id: `T${index + 1}`, name: `T${index + 1}`, enabled: true, items: list ?? [] })),
    ],
    markers: [],
    cast:
      def.cast === false
        ? null
        : {
            castId: newId<'Cast'>(),
            mode: 'template',
            variantIndex: 0,
            variantCount: 1,
            configVersion: 'casting.v4',
            sequenceConfidence: 0.9,
            slots: castSlots,
          },
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 0,
    updatedAt: 0,
  });
  return { timeline, ids, slots };
}

/** Frame where each V1 clip or gap starts, in order. */
export function starts(timeline: Timeline): number[] {
  const out: number[] = [];
  let frame = 0;
  const video = timeline.tracks[0];
  if (video?.kind !== 'video') return out;
  for (const item of video.items) {
    if (item.type === 'transition') continue;
    out.push(frame);
    frame += item.duration.value;
  }
  out.push(frame);
  return out;
}

export function clipById(timeline: Timeline, id: string): Clip {
  const video = timeline.tracks[0];
  const found = video?.kind === 'video' ? video.items.find((item) => item.id === id) : undefined;
  if (found?.type !== 'clip') throw new Error(`No clip ${id}`);
  return found;
}
