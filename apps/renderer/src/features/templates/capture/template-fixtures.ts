// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stand-in content for the skeleton capture (`pnpm --filter @taalcut/renderer bones:capture`): the capture browser
 * has no data, so the Templates list and a template's page render these to have their bones snapshotted. Shown
 * to nobody: a real list or template replaces them before anything is drawn.
 */
import type { Id, Template, TemplateId, TemplateSummary } from '@taalcut/core';

const FPS = { num: 30, den: 1 } as const;
const TRACKER = { num: 50, den: 1 } as const;
const at = (frames: number) => ({ value: frames, rate: FPS });
const id = <T>(n: number): T => `01K7C5M6Q8C0000000000000${String(n).padStart(2, '0')}` as T;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 12);

/* Capture stand-in words, never shown to anyone: not for the catalogue. */
/* eslint-disable lingui/no-unlocalized-strings */
const NAMES = ['Golden hour market', 'Slow morning routine', 'Three-hook vlog opener', 'Street food crawl'];
const TAGS = [['travel', 'golden-hour'], ['morning'], ['hooks'], []];
const SLOT_WORDS = [
  'Close-up of hands holding chai',
  'The stall from across the road',
  'Detail of the spices',
  'Medium shot, walking in',
  'A pour into a glass',
  'Wide of the market at dusk',
  'A sip, then a smile',
  'The street lights come on',
];
/* eslint-enable lingui/no-unlocalized-strings */
/** Eight slots of two beats or four at 120 BPM (15 frames a beat). */
const BEATS = [2, 2, 4, 2, 2, 4, 2, 4] as const;

function summary(index: number): TemplateSummary {
  const strip = BEATS.slice(0, 5 + index).map((beats) => beats * 15);
  const frames = strip.reduce((sum, each) => sum + each, 0);
  return {
    id: id<TemplateId>(index + 1),
    name: NAMES[index] ?? NAMES[0] ?? '',
    head: 2,
    origin: 'reference',
    platform: 'reels',
    duration: at(frames),
    slotCount: strip.length,
    bpm: 120,
    projectId: null,
    listed: true,
    archived: false,
    contactSheet: null,
    approvedSlots: index === 0 ? 2 : 0,
    tags: TAGS[index] ?? [],
    folderId: null,
    favourite: index === 0,
    trendFreshness: index < 2 ? { date: '2026-09-28', source: 'reference' } : null,
    provenance: null,
    slotStrip: strip,
    formatId: index === 2 ? 'vlog' : null,
    language: 'en',
    styleId: null,
    createdAt: NOW - (index + 3) * DAY,
    updatedAt: NOW - (index + 1) * DAY,
  };
}

/** Four rows, as a small library shows them. */
export const CAPTURE_SUMMARIES: readonly TemplateSummary[] = [0, 1, 2, 3].map(summary);

function captureTemplate(): Template {
  let start = 0;
  let beat = 0;
  const slots = BEATS.map((beats, index) => {
    const duration = beats * 15;
    const slot: Template['slots'][number] = {
      id: id<Id<'TemplateSlot'>>(20 + index),
      name: null,
      role: index === 0 ? 'hook' : index === 5 ? 'peak' : index === BEATS.length - 1 ? 'outro' : 'body',
      start: at(start),
      duration: at(duration),
      intent: {
        text: SLOT_WORDS[index] ?? '',
        shotType: index % 3 === 0 ? 'close' : index % 3 === 1 ? 'wide' : 'detail',
        motion: index % 2 === 0 ? 'static' : 'pan',
        subject: null,
        people: null,
        place: null,
        energy: 0.5,
        source: 'analyst',
      },
      beatAnchor: { beatIndex: beat, offset: at(0) },
      transitionIn: null,
      speedRamp: null,
      cut: { method: 'both', confidence: 0.9 },
      approved: index < 2,
      frame: index,
    };
    start += duration;
    beat += beats;
    return slot;
  });
  const first = slots[0];
  const frames = start;
  return {
    schemaVersion: 1,
    id: id<TemplateId>(1),
    version: 2,
    parentVersion: 1,
    createdAt: NOW - 3 * DAY,
    origin: {
      kind: 'reference',
      input: 'link',
      platform: 'reels',
      url: 'https://www.instagram.com/reel/C9xCapture/',
      fingerprint: 'c'.repeat(64),
      source: { duration: at(frames), rate: FPS, width: 1080, height: 1920 },
      crop: null,
      pipelineVersion: '1.0.0',
      configVersion: 'breakdown-2026-10',
      analysedAt: NOW - 3 * DAY,
    },
    canvas: { width: 1080, height: 1920, rate: FPS },
    duration: at(frames),
    slots,
    beatMap: {
      rate: TRACKER,
      beats: Array.from({ length: beat }, (_, i) => ({ value: i * 25, rate: TRACKER })),
      downbeats: [0, 4, 8, 12, 16, 20],
      bpm: 120,
      beatsPerBar: 4,
      confidence: 0.92,
      source: 'tracker',
    },
    text: first
      ? [
          {
            id: id<Id<'TextOverlay'>>(40),
            // eslint-disable-next-line lingui/no-unlocalized-strings -- capture stand-in, shown to nobody
            text: 'GOA IN 15 SECONDS',
            role: 'title',
            start: first.start,
            duration: first.duration,
            slotId: first.id,
            box: { x: 0.08, y: 0.18, width: 0.84, height: 0.08 },
            appearance: { size: 0.035, align: 'center', case: 'upper', background: 'none' },
            styleKey: 'title',
            reveal: 'pop',
            language: 'en',
            confidence: 0.93,
          },
        ]
      : [],
    audio: {
      kind: 'music',
      loudnessLufs: -9.8,
      sound: null,
      speech: null,
      waveform: {
        rate: TRACKER,
        peaks: Array.from({ length: Math.round((frames / 30) * 50) }, (_, i) => ((i * 7) % 25) / 25),
      },
    },
    pacing: {
      shotCount: slots.length,
      meanShot: at(Math.round(frames / slots.length)),
      medianShot: at(60),
      shortestShot: at(30),
      longestShot: at(60),
      hookEnd: at(30),
      cutsOnBeat: 1,
    },
    styleId: null,
    contactSheet: {
      asset: 'd'.repeat(64),
      mediaType: 'image/jpeg',
      columns: 6,
      rows: 2,
      tile: { width: 90, height: 160 },
      frames: slots.flatMap((slot) => [
        { at: at(slot.start.value + 2), slotId: slot.id },
        ...(slot.duration.value > 30 ? [{ at: at(slot.start.value + 40), slotId: slot.id }] : []),
      ]),
    },
    language: 'en',
  };
}

/** A template's page: Golden hour market's shape, eight slots at 120 BPM, two approved. */
export const CAPTURE_TEMPLATE: Template = captureTemplate();
export const CAPTURE_TEMPLATE_SUMMARY: TemplateSummary = {
  ...summary(0),
  slotCount: CAPTURE_TEMPLATE.slots.length,
  slotStrip: CAPTURE_TEMPLATE.slots.map((slot) => slot.duration.value),
  duration: CAPTURE_TEMPLATE.duration,
  // REF1: the reel kept, as a template read since then has it (one line on the overview).
  media: {
    file: 'reference.mp4',
    bytes: 6_300_000,
    durationMs: 24_000,
    sha256: 'c'.repeat(64),
    hasAudio: true,
    source: 'anonymous',
    keptAt: NOW,
  },
};
