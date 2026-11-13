// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A reference template and the user's timeline made from it, at 30 fps, for the timestamp tests.
 *
 * Template (12 s): slots 1–6 start at 0, 1.5, 3.6, 6, 8 and 10 s; slot 3 comes in with a whip.
 * Timeline (12.3 s): the same slots on V1 start at 0, 1.8, 3.9, 6.3, 8.3 and 10.3 s (the hook clip runs 0.3 s
 * longer); slot 5 is a gap; a whip transition sits before slot 3's clip.
 */
import {
  DEFAULT_MIX,
  FrameRates,
  newId,
  RationalTime,
  TimeRange,
  type SlotId,
  type Template,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';

const fps = FrameRates.fps30;
const at = (frames: number) => RationalTime.of(frames, fps);
const T0 = 1_760_000_000_000;
const SHA = 'b'.repeat(64);

/** Slot lengths in frames: 1.5, 2.1, 2.4, 2, 2 and 2 seconds. */
const SLOT_FRAMES = [45, 63, 72, 60, 60, 60];
const INTENTS = [
  'close-up of a coffee cup, fast push-in',
  'wide street at dawn',
  'hands opening a laptop',
  'walking shot from behind',
  'sunset over the sea',
  'smiling face, slow zoom out',
];

export interface Videos {
  readonly template: Template;
  readonly timeline: Timeline;
  readonly slotIds: readonly SlotId[];
  /** Per slot; null where the timeline has a gap. */
  readonly clipIds: readonly (TimelineItemId | null)[];
}

function template(slotIds: readonly SlotId[]): Template {
  let start = 0;
  const slots = SLOT_FRAMES.map((frames, index) => {
    const slot = {
      id: slotIds[index] ?? newId<'TemplateSlot'>(),
      name: index === 0 ? 'Hook' : null,
      role: index === 0 ? ('hook' as const) : ('body' as const),
      start: at(start),
      duration: at(frames),
      intent: {
        text: INTENTS[index] ?? 'a shot',
        shotType: 'wide' as const,
        motion: 'static' as const,
        subject: null,
        people: null,
        place: null,
        energy: 0.5,
        source: 'analyst' as const,
      },
      beatAnchor: null,
      transitionIn:
        index === 2
          ? {
              kind: 'whip' as const,
              before: at(3),
              after: at(3),
              direction: 'left' as const,
              confidence: 0.8,
            }
          : null,
      speedRamp: null,
      cut: { method: 'both' as const, confidence: 0.9 },
      approved: false,
      frame: null,
    };
    start += frames;
    return slot;
  });
  return {
    schemaVersion: 1,
    id: newId<'Template'>(),
    version: 1,
    parentVersion: null,
    createdAt: T0,
    origin: {
      kind: 'reference',
      input: 'link',
      platform: 'reels',
      url: 'https://www.instagram.com/reel/xyz',
      fingerprint: SHA,
      source: { duration: at(start), rate: fps, width: 1080, height: 1920 },
      crop: null,
      pipelineVersion: '1',
      configVersion: 'c1',
      analysedAt: T0,
    },
    canvas: { width: 1080, height: 1920, rate: fps },
    duration: at(start),
    slots,
    beatMap: null,
    text: [],
    audio: { kind: 'music', loudnessLufs: -14, sound: null, speech: null, waveform: null },
    pacing: {
      shotCount: slots.length,
      meanShot: at(60),
      medianShot: at(60),
      shortestShot: at(45),
      longestShot: at(72),
      hookEnd: at(45),
      cutsOnBeat: 0,
    },
    styleId: null,
    contactSheet: null,
    language: 'en',
  };
}

function clip(id: TimelineItemId, frames: number, slotId: SlotId) {
  return {
    type: 'clip' as const,
    id,
    media: {
      kind: 'video' as const,
      assetId: newId<'Asset'>(),
      shotId: null,
      available: TimeRange.of(at(0), at(600)),
    },
    // Room before the in point for a transition's overlap.
    sourceStart: at(30),
    duration: at(frames),
    speed: null,
    slotId,
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover' as const,
    audio: { gainDb: 0, muted: false },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  };
}

/** The template and a timeline cast from it (see the file's comment for where everything sits). */
export function videos(): Videos {
  const slotIds = SLOT_FRAMES.map(() => newId<'TemplateSlot'>());
  const made = template(slotIds);
  const clipIds = slotIds.map((_, index) => (index === 4 ? null : newId<'TimelineItem'>()));
  const items = slotIds.flatMap((slotId, index) => {
    const frames = index === 0 ? 54 : (SLOT_FRAMES[index] ?? 60);
    const clipId = clipIds[index];
    const item = clipId
      ? clip(clipId, frames, slotId)
      : { type: 'gap' as const, id: newId<'TimelineItem'>(), duration: at(frames), slotId };
    if (index !== 2) return [item];
    const whip = {
      type: 'transition' as const,
      id: newId<'TimelineItem'>(),
      kind: 'whip' as const,
      inOffset: at(3),
      outOffset: at(3),
      direction: 'left' as const,
    };
    return [whip, item];
  });
  const timeline: Timeline = {
    schemaVersion: 2,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Morning, variant 1',
    revision: 3,
    canvas: { width: 1080, height: 1920, rate: fps },
    template: { id: made.id, version: made.version },
    beatMap: null,
    tracks: [{ kind: 'video', id: 'V1', name: 'Video', enabled: true, items }],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: T0,
    updatedAt: T0,
  };
  return { template: made, timeline, slotIds, clipIds };
}
