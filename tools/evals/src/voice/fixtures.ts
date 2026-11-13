// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The placement fixture audio's own tests use: three 4 s slots, a 100 BPM map shifted 270 ms,
 * speeches short enough that each onset is the slot's beat. The beat a line should hit is computed
 * here from that rule (downbeat within one beat of the slot, else the first beat at or after it),
 * not by calling planPlacement. Nothing shells out.
 */
import { join } from 'node:path';
import {
  DEFAULT_MIX,
  FrameRate,
  idSchema,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  timelineSchema,
  type BeatMap,
  type SequenceItem,
  type SlotId,
  type Timeline,
  type VoiceLineId,
} from '@taalcut/core';
import type { PlacementLine } from '@taalcut/audio';
import { writeJson } from '../files';
import type { VoiceLabel, VoiceLineLabel } from './schema';

const LINE_RATE = FrameRate.of(48_000, 1);

export interface VoiceBuilt {
  readonly label: VoiceLabel;
  readonly timeline: Timeline;
  readonly lines: PlacementLine[];
}

function steadyBeatMap(bpm: number, seconds: number): BeatMap {
  const rate = FrameRate.of(1000, 1);
  const beatMs = 60_000 / bpm;
  const beats = Array.from({ length: Math.floor((seconds * 1000) / beatMs) + 1 }, (_, index) =>
    RationalTime.of(Math.round(index * beatMs), rate),
  );
  return {
    rate,
    beats,
    downbeats: beats.map((_, index) => index).filter((index) => index % 4 === 0),
    bpm,
    beatsPerBar: 4,
    confidence: 1,
    source: 'tracker',
  };
}

function shifted(map: BeatMap, shiftMs: number): BeatMap {
  return { ...map, beats: map.beats.map((beat) => RationalTime.of(beat.value + shiftMs, beat.rate)) };
}

/** Downbeat within one beat of the slot, else the first beat at or after it. Mirrors planPlacement. */
function slotBeat(
  beats: readonly number[],
  downbeats: ReadonlySet<number>,
  beatFrames: number,
  slotStart: number,
): number {
  const first = beats.findIndex((beat) => beat >= slotStart);
  if (first < 0) throw new Error(`no beat at or after frame ${slotStart}`);
  for (let index = first; index < beats.length && (beats[index] ?? 0) <= slotStart + beatFrames; index += 1) {
    if (downbeats.has(index)) return index;
  }
  return first;
}

function beatFramesOf(timeline: Timeline): { beats: number[]; downbeats: Set<number>; beatFrames: number } {
  const map = timeline.beatMap;
  if (map === null || map.beats.length < 2) throw new Error('voice fixture needs a beat map');
  const beats = map.beats.map((beat) => RationalTime.toFrames(beat, timeline.canvas.rate));
  const gaps = beats
    .slice(1)
    .map((beat, index) => beat - (beats[index] ?? 0))
    .sort((a, b) => a - b);
  return { beats, downbeats: new Set(map.downbeats), beatFrames: gaps[Math.floor(gaps.length / 2)] ?? 15 };
}

function samples(seconds: number): ReturnType<typeof RationalTime.of> {
  return RationalTime.of(Math.round(seconds * 48_000), LINE_RATE);
}

export function voiceTimeline(label: VoiceLabel): Timeline {
  const rate = FrameRate.of(label.fps);
  const slots = label.slots.map((slot) => idSchema<'TemplateSlot'>().parse(slot));
  const items: SequenceItem[] = slots.map((slotId) => ({
    type: 'clip',
    id: newId<'TimelineItem'>(),
    media: {
      kind: 'video',
      assetId: newId<'Asset'>(),
      shotId: null,
      available: {
        start: RationalTime.of(0, rate),
        duration: RationalTime.of(label.slotFrames + 60, rate),
      },
    },
    sourceStart: RationalTime.of(0, rate),
    duration: RationalTime.of(label.slotFrames, rate),
    speed: null,
    slotId,
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: 0, muted: false },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  }));
  const map = shifted(steadyBeatMap(label.bpm, label.beatSeconds), label.shiftMs);
  return timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Voice',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate },
    template: null,
    beatMap: map,
    tracks: [{ kind: 'video', id: 'V1', name: 'Video', enabled: true, items }],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 1,
    updatedAt: 1,
  });
}

export function placementLines(label: VoiceLabel): PlacementLine[] {
  const slots = label.slots.map((slot) => idSchema<'TemplateSlot'>().parse(slot));
  return label.lines.map((line) => {
    const slotId: SlotId | null = slots[line.slotIndex] ?? null;
    if (slotId === null) throw new Error(`line ${line.lineId} has no slot ${line.slotIndex}`);
    const lineId: VoiceLineId = idSchema<'VoiceLine'>().parse(line.lineId);
    return {
      lineId,
      slotId,
      assetId: newId<'Asset'>(),
      duration: samples(line.onsetSeconds + line.speechSeconds + line.tailSeconds),
      onset: samples(line.onsetSeconds),
      speechEnd: samples(line.onsetSeconds + line.speechSeconds),
    };
  });
}

function withExpectedBeats(label: VoiceLabel, timeline: Timeline): VoiceLabel {
  const grid = beatFramesOf(timeline);
  const lines: VoiceLineLabel[] = label.lines.map((line) => {
    const beatIndex = slotBeat(
      grid.beats,
      grid.downbeats,
      grid.beatFrames,
      line.slotIndex * label.slotFrames,
    );
    const wordStartFrame = grid.beats[beatIndex];
    if (wordStartFrame === undefined) throw new Error(`beat ${beatIndex} missing`);
    return { ...line, beatIndex, wordStartFrame };
  });
  return { ...label, lines };
}

/** Three lines whose speeches fit their slots, so each first word is that slot's beat. */
export function voiceCase(): VoiceBuilt {
  const slots = [newId<'TemplateSlot'>(), newId<'TemplateSlot'>(), newId<'TemplateSlot'>()];
  const draft: VoiceLabel = {
    caseId: 'steady',
    synthetic: true,
    fps: 30,
    timelineFrames: 360,
    slotFrames: 120,
    slots,
    bpm: 100,
    beatSeconds: 13,
    shiftMs: 270,
    lines: [
      {
        lineId: newId<'VoiceLine'>(),
        slotIndex: 0,
        beatIndex: 0,
        wordStartFrame: 0,
        speechSeconds: 2,
        onsetSeconds: 0.15,
        tailSeconds: 0.3,
      },
      {
        lineId: newId<'VoiceLine'>(),
        slotIndex: 1,
        beatIndex: 0,
        wordStartFrame: 0,
        speechSeconds: 2.5,
        onsetSeconds: 0.15,
        tailSeconds: 0.3,
      },
      {
        lineId: newId<'VoiceLine'>(),
        slotIndex: 2,
        beatIndex: 0,
        wordStartFrame: 0,
        speechSeconds: 1.5,
        onsetSeconds: 0.15,
        tailSeconds: 0.3,
      },
    ],
  };
  const timeline = voiceTimeline(draft);
  const label = withExpectedBeats(draft, timeline);
  return { label, timeline, lines: placementLines(label) };
}

export function writeVoiceFixtures(dir: string): { labels: string } {
  writeJson(join(dir, 'cases.json'), [voiceCase().label]);
  return { labels: dir };
}
