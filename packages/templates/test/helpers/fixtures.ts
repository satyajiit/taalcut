// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Template v1 fixtures: a reference breakdown with four slots on a 120 BPM beat map, plus id factories. */
import {
  FrameRate,
  FrameRates,
  newId,
  RationalTime,
  type FrameRate as Rate,
  type SlotIntent,
  type Template,
} from '@taalcut/core';
import type { TemplateIds } from '../../src/index';

export const T0 = 1_760_000_000_000;
export const SHA = 'a'.repeat(64);
const fps30 = FrameRates.fps30;
const beatRate = FrameRate.of(50);

export const at = (value: number, rate: Rate = fps30): RationalTime => RationalTime.of(value, rate);
export const json = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

export const intent = (text: string, source: SlotIntent['source'] = 'analyst'): SlotIntent => ({
  text,
  shotType: 'wide',
  motion: 'static',
  subject: null,
  people: null,
  place: null,
  energy: 0.5,
  source,
});

/** Ids in creation order, readable in failures. */
export function sequentialIds(): TemplateIds {
  return { template: () => newId(), slot: () => newId(), overlay: () => newId() };
}

/**
 * A 4-second reference at 30 fps: slots of 30, 15, 45 and 30 frames, cuts on
 * the 120 BPM beats (every 15 frames), a dissolve into slot 2, a ramp in slot 3,
 * an overlay in slot 1 and one in slot 3, a four-tile contact sheet.
 */
export function referenceTemplate(): Template {
  const ids = [
    newId<'TemplateSlot'>(),
    newId<'TemplateSlot'>(),
    newId<'TemplateSlot'>(),
    newId<'TemplateSlot'>(),
  ];
  const lengths = [30, 15, 45, 30];
  const starts = [0, 30, 45, 90];
  const slots = ids.map((id, index) => ({
    id,
    name: index === 0 ? 'Hook' : null,
    role: index === 0 ? ('hook' as const) : index === 3 ? ('outro' as const) : ('body' as const),
    start: at(starts[index]!),
    duration: at(lengths[index]!),
    intent: intent(`shot ${index + 1}`),
    // Beats every 25 ticks at 50/1 = 15 frames at 30/1; slot n starts on beat starts[n] / 15.
    beatAnchor: { beatIndex: starts[index]! / 15, offset: at(0) },
    transitionIn:
      index === 2
        ? { kind: 'dissolve' as const, before: at(4), after: at(4), direction: null, confidence: 0.8 }
        : null,
    speedRamp:
      index === 3
        ? {
            points: [
              { at: at(0), speed: 1 },
              { at: at(20), speed: 2 },
            ],
            curve: 'linear' as const,
          }
        : null,
    cut: { method: index === 0 ? ('rule' as const) : ('both' as const), confidence: 0.9 },
    approved: false,
    frame: index,
  }));
  const overlay = (slotIndex: number, start: number, text: string) => ({
    id: newId<'TextOverlay'>(),
    text,
    role: 'title' as const,
    start: at(start),
    duration: at(20),
    slotId: ids[slotIndex]!,
    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
    appearance: { size: 0.04, align: 'center' as const, case: 'mixed' as const, background: 'none' as const },
    styleKey: 'title',
    reveal: 'pop' as const,
    language: 'en',
    confidence: 0.95,
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
      url: 'https://www.instagram.com/reel/abc',
      fingerprint: SHA,
      source: { duration: at(120), rate: fps30, width: 1080, height: 1920 },
      crop: null,
      pipelineVersion: '1',
      configVersion: 'breakdown.v1',
      analysedAt: T0,
    },
    canvas: { width: 1080, height: 1920, rate: fps30 },
    duration: at(120),
    slots,
    beatMap: {
      rate: beatRate,
      beats: [0, 25, 50, 75, 100, 125, 150, 175].map((value) => at(value, beatRate)),
      downbeats: [0, 4],
      bpm: 120,
      beatsPerBar: 4,
      confidence: 0.9,
      source: 'tracker',
    },
    text: [overlay(1, 32, 'Goa'), overlay(3, 95, 'Follow for more')],
    audio: {
      kind: 'music',
      loudnessLufs: -14,
      sound: { title: 'Original audio', artist: null },
      speech: null,
      waveform: { rate: beatRate, peaks: [0.1, 0.5, 0.2] },
    },
    pacing: {
      shotCount: 4,
      meanShot: at(30),
      medianShot: at(30),
      shortestShot: at(15),
      longestShot: at(45),
      hookEnd: at(30),
      cutsOnBeat: 1,
    },
    styleId: null,
    contactSheet: {
      asset: SHA,
      mediaType: 'image/jpeg',
      columns: 4,
      rows: 1,
      tile: { width: 101, height: 180 },
      frames: ids.map((slotId, index) => ({ at: at(starts[index]! + 5), slotId })),
    },
    language: 'en',
  };
}
