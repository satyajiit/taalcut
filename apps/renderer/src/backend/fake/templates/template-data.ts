// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output and on-screen text: data, never translated */

/**
 * The fake's templates: Template v1 documents that pass core's invariants
 * (test/fake-templates.test.ts parses them with templateSchema). "Golden hour
 * market" is the one the pages are built around: a 15 s reel at 120 BPM, 12
 * slots on the beat, four text overlays and a contact sheet.
 */
import type { Id, Template } from '@taalcut/core';
import { fakeUlid, prng, sceneHash } from '../library/seed';

export const TEMPLATE_KIND = { template: 5, slot: 6, overlay: 7, folder: 8, hub: 9 } as const;
const FPS = { num: 30, den: 1 } as const;
const TRACKER = { num: 50, den: 1 } as const;
export const TEMPLATE_T0 = Date.UTC(2026, 9, 11, 16, 20);

const at = (frames: number) => ({ value: frames, rate: FPS });

import { GOLDEN_HOUR, HOOK_TEST, MORNING, type TemplatePlan } from './template-plans';

export { GOLDEN_HOUR, HOOK_TEST, MORNING, type TemplatePlan } from './template-plans';

export const TEMPLATE_PLANS = [GOLDEN_HOUR, MORNING, HOOK_TEST] as const;

export const slotId = (plan: TemplatePlan, index: number) =>
  fakeUlid<'TemplateSlot'>(TEMPLATE_KIND.slot, plan.n * 100 + index);

/** Peaks at 50 per second: a beat-synced envelope with downbeats louder, like a mastered pop track. */
function waveform(plan: TemplatePlan, seconds: number): number[] {
  const random = prng(plan.n * 977);
  const beatUnits = plan.bpm ? (60 / plan.bpm) * 50 : 0;
  return Array.from({ length: Math.round(seconds * 50) }, (_, i) => {
    const base = 0.28 + random() * 0.18;
    if (!beatUnits) return Math.round(base * 100) / 100;
    const since = i % beatUnits;
    const beat = Math.floor(i / beatUnits);
    const hit = (beat % 4 === 0 ? 0.62 : 0.45) * Math.exp(-since / 5);
    return Math.round(Math.min(1, base + hit) * 100) / 100;
  });
}

/**
 * A template's waveform as the breakdown stored it before keep's `04e87739`: the onset envelope clamped to 1, so
 * all but a few peaks read 1 (663 of 666 in the gate's reel).
 */
export function withFlatWaveform(template: Template): Template {
  const waveform = template.audio.waveform;
  if (!waveform) return template;
  const peaks = waveform.peaks.map((_, i) => (i % 222 === 5 ? 0.84 : 1));
  return { ...template, audio: { ...template.audio, waveform: { ...waveform, peaks } } };
}

/** Version 1 of a plan: what the breakdown made. */
export function buildTemplate(plan: TemplatePlan): Template {
  const id = fakeUlid<'Template'>(TEMPLATE_KIND.template, plan.n);
  const frames = plan.slots.reduce((sum, slot) => sum + slot.beats * plan.beatFrames, 0);
  const seconds = frames / 30;
  const unitsPerBeat = (plan.beatFrames / 30) * 50;
  const beatCount = plan.bpm ? Math.floor(frames / plan.beatFrames) : 0;
  let start = 0;
  let beat = 0;
  const slots = plan.slots.map((slot, index) => {
    const duration = slot.beats * plan.beatFrames;
    const built: Template['slots'][number] = {
      id: slotId(plan, index),
      name: null,
      role: slot.role,
      start: at(start),
      duration: at(duration),
      intent: {
        text: slot.text,
        shotType: slot.shotType,
        motion: slot.motion,
        subject: null,
        people: slot.people ?? null,
        place: slot.place ?? null,
        energy: slot.energy,
        source: 'analyst',
      },
      beatAnchor: plan.bpm ? { beatIndex: beat, offset: at(0) } : null,
      transitionIn:
        index > 0 && slot.role === 'peak' && plan.slots[index - 1]?.role !== 'peak'
          ? { kind: 'whip', before: at(2), after: at(2), direction: 'left', confidence: 0.81 }
          : null,
      speedRamp: null,
      cut:
        index === 0
          ? { method: 'rule', confidence: 1 }
          : { method: 'both', confidence: 0.86 + ((index * 7) % 13) / 100 },
      approved: false,
      frame: index,
    };
    start += duration;
    beat += slot.beats;
    return built;
  });
  const lengths = slots.map((slot) => slot.duration.value).sort((a, b) => a - b);
  const columns = Math.min(6, slots.length);
  const sheetHash = sceneHash(plan.scene, plan.n, 9);
  return {
    schemaVersion: 1,
    id,
    version: 1,
    parentVersion: null,
    createdAt: TEMPLATE_T0 - plan.n * 3_600_000,
    origin: plan.bpm
      ? {
          kind: 'reference',
          input: 'link',
          platform: plan.platform,
          url: `https://www.instagram.com/reel/C9x${plan.n}GoaGolden/`,
          fingerprint: sceneHash(plan.scene, plan.n, 4),
          source: { duration: at(frames), rate: FPS, width: 1080, height: 1920 },
          crop: null,
          pipelineVersion: '1.0.0',
          configVersion: 'breakdown-2026-10',
          analysedAt: TEMPLATE_T0 - plan.n * 3_600_000,
        }
      : {
          kind: 'format',
          formatId: 'vlog',
          formatVersion: '1',
          target: at(frames),
          brief: 'A quick answer to one question',
        },
    canvas: { width: 1080, height: 1920, rate: FPS },
    duration: at(frames),
    slots,
    beatMap: plan.bpm
      ? {
          rate: TRACKER,
          beats: Array.from({ length: beatCount }, (_, i) => ({
            value: Math.round(i * unitsPerBeat),
            rate: TRACKER,
          })),
          downbeats: Array.from({ length: Math.ceil(beatCount / 4) }, (_, i) => i * 4),
          bpm: plan.bpm,
          beatsPerBar: 4,
          confidence: 0.92,
          source: 'tracker',
        }
      : null,
    text: plan.overlays.map((overlay, index) => {
      const slot = slots[overlay.slot]!;
      return {
        id: fakeUlid<'TextOverlay'>(TEMPLATE_KIND.overlay, plan.n * 100 + index),
        text: overlay.text,
        role: overlay.role,
        start: slot.start,
        duration: slot.duration,
        slotId: slot.id,
        box: { x: 0.08, y: overlay.role === 'title' ? 0.18 : 0.7, width: 0.84, height: 0.08 },
        appearance: {
          size: 0.035,
          align: 'center',
          case: 'upper',
          background: overlay.role === 'cta' ? 'box' : 'none',
        },
        styleKey: overlay.role === 'title' ? 'title' : 'label',
        reveal: overlay.role === 'title' ? 'wordByWord' : 'pop',
        language: plan.language,
        confidence: 0.93,
      };
    }),
    audio: {
      kind: plan.bpm ? 'music' : 'voice',
      loudnessLufs: plan.bpm ? -9.8 : -16.2,
      sound: plan.bpm ? { title: 'Golden Hour (sped up)', artist: 'JVKE' } : null,
      speech: null,
      waveform: { rate: TRACKER, peaks: waveform(plan, seconds) },
    },
    pacing: {
      shotCount: slots.length,
      meanShot: at(Math.round(frames / slots.length)),
      medianShot: at(lengths[Math.floor(lengths.length / 2)]!),
      shortestShot: at(lengths[0]!),
      longestShot: at(lengths[lengths.length - 1]!),
      hookEnd: at(Math.min(slots[0]!.duration.value, 90)),
      cutsOnBeat: plan.bpm ? 1 : null,
    },
    styleId: null,
    contactSheet: {
      asset: sheetHash,
      mediaType: 'image/jpeg',
      columns,
      rows: Math.ceil(slots.length / columns),
      tile: { width: 90, height: 160 },
      frames: slots.map((slot) => ({
        at: at(slot.start.value + Math.floor(slot.duration.value / 2)),
        slotId: slot.id,
      })),
    },
    language: plan.language,
  };
}

export const templateIdOf = (plan: TemplatePlan): Id<'Template'> =>
  fakeUlid<'Template'>(TEMPLATE_KIND.template, plan.n);
