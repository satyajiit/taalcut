// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the Make fakes' Timeline v1 documents from a plan: clips cut on the
 * beat from the shot pool, the cast (each slot's pick, three alternates and
 * a confidence), text items from the template's overlays and a caption
 * track. The result passes core's timelineSchema (test/fake-make.test.ts).
 */
import {
  DEFAULT_MIX,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  type BeatMap,
  type CaptionStyle,
  type CaptionTrack,
  type CastId,
  type ProjectId,
  type SlotCast,
  type SlotId,
  type TemplateRef,
  type TextItem,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { prng } from '../library/seed';
import { MAKE_KIND, seededItem } from './ids';
import { centredStart, type PoolShot } from './shot-pool';
import { fakeUlid } from '../library/seed';

export const CANVAS_RATE = { num: 30, den: 1 } as const;
const at = (frames: number) => RationalTime.of(frames, CANVAS_RATE);

export interface SlotSpec {
  readonly slotId: SlotId | null;
  readonly frames: number;
  /** The beat the slot's cut sits on (an index into the beat map). */
  readonly beatIndex: number | null;
}

export interface TextSpec {
  readonly slot: number;
  readonly item: Omit<TextItem, 'id' | 'start' | 'duration' | 'slotId' | 'type' | 'origin'>;
}

export interface TimelinePlan {
  readonly id: TimelineId;
  readonly n: number;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly template: TemplateRef | null;
  readonly beatMap: BeatMap | null;
  readonly slots: readonly SlotSpec[];
  readonly pool: readonly PoolShot[];
  readonly variantIndex: number;
  readonly variantCount: number;
  readonly castId: CastId | null;
  readonly mode: 'template' | 'story';
  readonly text: readonly TextSpec[];
  /** Caption lines, each over one slot. */
  readonly captions: readonly { readonly slot: number; readonly text: string }[];
  readonly language: string;
  /** Slots the casting engine was unsure of (reranked by the vision model). */
  readonly unsure: readonly number[];
  readonly createdAt: number;
}

/** Render's classic style: white words with an outline, the spoken word popping, a little under the middle. */
export const CAPTION_STYLE: CaptionStyle = {
  version: 1,
  font: 'poppins',
  weight: 700,
  sizePx: 64,
  textColor: '#ffffff',
  highlightColor: '#ffd166',
  stroke: { color: '#1a1a1a', widthPx: 4 },
  background: null,
  highlight: 'pop',
  letterCase: 'asIs',
  anchorY: 0.58,
  maxLines: 2,
  maxWords: 4,
};

/** Words spread evenly over a range, frame-aligned and inside it. */
function captionTrack(plan: TimelinePlan, starts: readonly number[]): CaptionTrack {
  return {
    enabled: true,
    language: plan.language,
    style: CAPTION_STYLE,
    styleSource: 'reference',
    cues: plan.captions.flatMap(({ slot, text }, index) => {
      const start = starts[slot];
      const frames = plan.slots[slot]?.frames;
      if (start === undefined || frames === undefined) return [];
      const words = text.split(/\s+/).filter(Boolean);
      const each = Math.max(1, Math.floor(frames / words.length));
      return [
        {
          id: fakeUlid<'CaptionCue'>(MAKE_KIND.cue, plan.n * 100 + index),
          range: { start: at(start), duration: at(frames) },
          words: words.map((word, w) => ({
            text: word,
            range: {
              start: at(start + w * each),
              duration: at(w === words.length - 1 ? frames - w * each : each),
            },
            confidence: 0.97,
          })),
          edited: false,
        },
      ];
    }),
  };
}

export function buildTimeline(plan: TimelinePlan): { timeline: Timeline; shots: Map<string, PoolShot> } {
  const random = prng(plan.n * 389 + plan.variantIndex);
  const shots = new Map<string, PoolShot>();
  const take = (index: number) => {
    const shot = plan.pool[index % plan.pool.length]!;
    shots.set(shot.candidate.shotId ?? shot.candidate.assetId, shot);
    return shot;
  };
  const starts: number[] = [];
  let start = 0;
  const cast: SlotCast[] = [];
  const clips = plan.slots.map((slot, index) => {
    starts.push(start);
    start += slot.frames;
    const base = plan.variantIndex * 5 + index * 4;
    const pick = take(base);
    const alternates = [take(base + 1), take(base + 2), take(base + 3)];
    const id = seededItem(plan.n, index);
    const sourceStart = centredStart(pick, slot.frames, CANVAS_RATE);
    if (plan.castId && slot.slotId) {
      const unsure = plan.unsure.includes(index);
      cast.push({
        slotId: slot.slotId,
        clipId: id,
        pick: { ...pick.candidate, sourceStart },
        alternates: alternates.map((shot) => shot.candidate),
        confidence: unsure ? 0.41 : Math.round((0.62 + random() * 0.33) * 100) / 100,
        needsRerank: false,
        note: unsure ? 'reranked' : null,
      });
    }
    return {
      type: 'clip' as const,
      id,
      media: {
        kind: 'video' as const,
        assetId: pick.candidate.assetId,
        shotId: pick.candidate.shotId,
        available: pick.available,
      },
      sourceStart,
      duration: at(slot.frames),
      speed: null,
      slotId: slot.slotId,
      syncPoint: null,
      beatAnchor: slot.beatIndex === null ? null : { beatIndex: slot.beatIndex, offset: at(0) },
      fit: 'cover' as const,
      audio: { gainDb: 0, muted: true },
      locked: false,
      enabled: true,
      stillMotion: null,
      reframe: null,
    };
  });
  const text = plan.text.map(({ slot, item }, index) => ({
    ...item,
    type: 'text' as const,
    id: seededItem(plan.n, 50 + index),
    start: at(starts[slot] ?? 0),
    duration: at(plan.slots[slot]?.frames ?? 1),
    slotId: plan.slots[slot]?.slotId ?? null,
    origin: 'template' as const,
  }));
  const timeline: Timeline = {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: plan.id,
    projectId: plan.projectId,
    name: plan.name,
    revision: 1,
    canvas: { width: 1080, height: 1920, rate: CANVAS_RATE },
    template: plan.template,
    beatMap: plan.beatMap,
    tracks: [
      { kind: 'video', id: 'V1', name: '', enabled: true, items: clips },
      { kind: 'text', id: 'T1', name: '', enabled: true, items: text },
    ],
    markers: [],
    cast: plan.castId
      ? {
          castId: plan.castId,
          mode: plan.mode,
          variantIndex: plan.variantIndex,
          variantCount: plan.variantCount,
          configVersion: 'casting-2026-10',
          sequenceConfidence: 0.78,
          slots: cast,
        }
      : null,
    captions: plan.captions.length > 0 ? captionTrack(plan, starts) : null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: plan.createdAt,
    updatedAt: plan.createdAt,
  };
  return { timeline, shots };
}

/** A beat map at `bpm` for `seconds`, as the tracker writes it (50 units a second), downbeats every 4. */
export function steadyBeats(bpm: number, seconds: number): BeatMap {
  const rate = { num: 50, den: 1 };
  const step = (60 / bpm) * 50;
  const count = Math.floor((seconds * bpm) / 60);
  return {
    rate,
    beats: Array.from({ length: count }, (_, i) => RationalTime.of(Math.round(i * step), rate)),
    downbeats: Array.from({ length: Math.ceil(count / 4) }, (_, i) => i * 4),
    bpm,
    beatsPerBar: 4,
    confidence: 0.9,
    source: 'tracker',
  };
}

/** A timeline's length in canvas frames (V1's clips and gaps). */
export function framesOf(timeline: Timeline): number {
  return timeline.tracks[0]!.items.reduce(
    (sum, item) => sum + (item.type === 'transition' ? 0 : item.duration.value),
    0,
  );
}
