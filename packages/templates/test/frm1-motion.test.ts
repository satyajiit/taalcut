// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-MOT: the camera's measured move in the template. The draft's pairs and the slot measure read from them, the
 * words the Analyst and the strip describer get, the measure step's spans, and template.setMotion on core's real bus
 * with the motion doubt travelling with the intent. The template fixture: four slots at 0, 30, 45 and 90 (30 fps).
 */
import { describe, expect, it } from 'vitest';
import {
  FrameRates,
  ok,
  RationalTime,
  TEMPLATE_COMMANDS as N,
  templateSchema,
  type CameraMotionMeasure,
  type Template,
} from '@taalcut/core';
import {
  cameraWords,
  draftCameraSchema,
  encodePairs,
  measureCamera,
  measuredMotion,
  pairsIn,
  slotMeasure,
  subjectBoxesAt,
} from '../src/breakdown/camera';
import { measuredQuestion } from '../src/breakdown/looks';
import type { StepContext } from '../src/breakdown/steps';
import { at, json, referenceTemplate } from './helpers/fixtures';
import { setupTemplates, UI } from './helpers/setup';

const still = {
  dx: 0,
  dy: 0,
  scale: 0,
  rotation: 0,
  inliers: 0.9,
  points: 150,
  residual: 0.001,
  subject: null,
};
const pairs = (n: number, from: number, motion: typeof still | null) =>
  Array.from({ length: n }, (_, i) => ({ frame: from + 3 * (i + 1), seconds: 0.1, motion }));

const camera = draftCameraSchema.parse({
  version: 1,
  width: 384,
  height: 216,
  segments: [
    { start: 0, end: 30, pairs: encodePairs(pairs(9, 0, still)) },
    { start: 30, end: 45, pairs: encodePairs(pairs(4, 30, { ...still, dx: -0.012 })) },
    { start: 45, end: 90, pairs: encodePairs(pairs(14, 45, { ...still, dx: -0.012 })) },
    { start: 90, end: 99, pairs: encodePairs(pairs(2, 90, null)), fade: true },
  ],
});

describe('the draft’s camera pairs', () => {
  it('keeps a pair’s numbers and an unmeasured one, and reads a slot from the spans inside it', () => {
    const decoded = pairsIn(camera, { start: 30, end: 90 });
    expect(decoded).toHaveLength(18);
    expect(decoded[0]!.motion?.dx).toBeCloseTo(-0.012, 9);
    // The fade's tail is left out; a slot cut through a span reads nothing from it.
    expect(pairsIn(camera, { start: 0, end: 99 })).toHaveLength(27);
    expect(pairsIn(camera, { start: 0, end: 40 })).toHaveLength(9);
    expect(encodePairs(pairs(1, 0, null))).toEqual([[3, 0.1]]);
  });

  it('measures a slot and words its move; no camera is no measure', () => {
    const pan = slotMeasure(camera, { start: 30, end: 90 })!;
    expect(pan).toMatchObject({ label: 'pan', version: 1 });
    expect(pan.panX).toBeCloseTo(0.12, 5);
    expect(cameraWords(pan)).toBe('pan right');
    expect(cameraWords(slotMeasure(camera, { start: 0, end: 30 }))).toBe(
      'static: the camera holds still (a subject may move)',
    );
    expect(slotMeasure(undefined, { start: 0, end: 30 })).toBeNull();
    expect(slotMeasure(camera, { start: 95, end: 99 })).toBeNull();
    // Nothing tracked at all (a flat card): no measure, so nothing to ask.
    const flat = { ...camera, segments: [{ start: 0, end: 30, pairs: encodePairs(pairs(9, 0, null)) }] };
    expect(slotMeasure(flat, { start: 0, end: 30 })).toBeNull();
  });

  it('a sure measure is the motion; an unsure one is unknown and asked about', () => {
    const sure: CameraMotionMeasure = {
      panX: 0.2,
      panY: 0,
      scale: 0,
      rotation: 0,
      jitter: 0,
      label: 'pan',
      confidence: 0.8,
      version: 1,
    };
    expect(measuredMotion(sure)).toEqual({ motion: 'pan', unsure: false });
    expect(measuredMotion({ ...sure, confidence: 0.3 })).toEqual({ motion: null, unsure: true });
    expect(measuredMotion({ ...sure, label: null })).toEqual({ motion: null, unsure: true });
    expect(measuredMotion(null)).toEqual({ motion: null, unsure: false });
    expect(cameraWords({ ...sure, confidence: 0.3, panY: -0.15 })).toBe('unsure: maybe pan up and right');
  });

  it('tells the strip describer a sure move as fact, and not to guess an unsure one', () => {
    expect(measuredQuestion('pan right')).toContain('was measured: pan right. Take that as fact');
    expect(measuredQuestion('unsure: maybe pan right')).toContain('do not guess it');
    expect(measuredQuestion('unsure: maybe pan right')).not.toContain('pan right');
  });
});

describe('measureCamera', () => {
  const rate = FrameRates.fps30;
  it('measures between every candidate cut and fade, leaving overlays out while they show', async () => {
    const asked: { ranges: { start: number; end: number }[]; ignored: unknown; people: unknown }[] = [];
    const ctx = {
      path: '/reel.mp4',
      total: 120,
      rate,
      signal: new AbortController().signal,
      analysers: {
        vision: {
          cameraMotion: async (
            _path: string,
            options: Parameters<NonNullable<StepContext['analysers']['vision']['cameraMotion']>>[1],
          ) => {
            asked.push({
              ranges: [...options.ranges],
              ignored: [options.ignore?.(10), options.ignore?.(70)],
              people: [options.subjects?.(3), options.subjects?.(60)],
            });
            return ok({
              version: 1,
              width: 384,
              height: 216,
              shots: options.ranges.map((range) => ({ ...range, pairs: pairs(2, range.start, still) })),
            });
          },
        },
      },
    } as unknown as StepContext;
    const box = { x: 0.1, y: 0.8, width: 0.8, height: 0.1 };
    const person = { box: { x: 0.4, y: 0.2, width: 0.2, height: 0.7 }, confidence: 0.9 };
    const measured = await measureCamera(ctx, {
      cuts: [45, 30],
      fades: [100],
      overlays: [{ start: RationalTime.of(0, rate), duration: RationalTime.of(30, rate), box }],
      subjects: {
        version: 1,
        detector: 'vision',
        hz: 4,
        samples: [{ t: RationalTime.of(0, rate), heads: [], people: [person] }],
      },
    });
    expect(measured.ok && measured.value?.segments.map((s) => [s.start, s.end, s.fade ?? false])).toEqual([
      [0, 30, false],
      [30, 45, false],
      [45, 100, false],
      [100, 120, true],
    ]);
    expect(asked[0]!.ignored).toEqual([[box], undefined]);
    expect(asked[0]!.people).toEqual([[person.box], undefined]);
  });

  it('is nothing without the port', async () => {
    const ctx = { analysers: { vision: {} } } as unknown as StepContext;
    expect(await measureCamera(ctx, { cuts: [], fades: [], overlays: [], subjects: null })).toEqual(ok(null));
    expect(subjectBoxesAt(null, rate)).toBeUndefined();
  });
});

async function created() {
  const base = referenceTemplate();
  const measure: CameraMotionMeasure = {
    panX: 0.04,
    panY: 0,
    scale: 0,
    rotation: 0,
    jitter: 0.001,
    label: 'pan',
    confidence: 0.4,
    version: 1,
  };
  const template: Template = {
    ...base,
    slots: base.slots.map((slot, index) =>
      index === 1
        ? {
            ...slot,
            intent: { ...slot.intent, motion: null },
            motionMeasure: measure,
            doubts: [{ reason: 'intentVague' }, { reason: 'motionUnsure', confidence: 0.6 }],
          }
        : slot,
    ),
  };
  const setup = setupTemplates();
  await setup.bus.dispatch(N.create, { projectId: setup.projectA, template, name: 'Goa', listed: true }, UI);
  const head = async (): Promise<Template> => {
    const got = await setup.service.get({ templateId: template.id });
    if (!got.ok) throw new Error(got.error.code);
    expect(templateSchema.safeParse(json(got.value.template)).success).toBe(true);
    return got.value.template;
  };
  const run = (name: string, payload: object) =>
    setup.bus.dispatch(name, { projectId: setup.projectA, templateId: template.id, ...payload }, UI);
  return { ...setup, template, head, run };
}

const reasons = (slot: Template['slots'][number]) => slot.doubts?.map((doubt) => doubt.reason) ?? [];

describe('template.setMotion', () => {
  it('sets the camera move the person picked and answers the motion doubt only; undo puts both back', async () => {
    const { run, head, template, bus, projectA } = await created();
    const slotId = template.slots[1]!.id;
    const done = await run(N.setMotion, { baseVersion: 1, slotId, motion: 'tracking' });
    expect(done.ok).toBe(true);
    const after = (await head()).slots[1]!;
    expect(after.intent.motion).toBe('tracking');
    expect(reasons(after)).toEqual(['intentVague']);
    expect(after.motionMeasure?.label).toBe('pan');
    await bus.undo(projectA, UI);
    const back = (await head()).slots[1]!;
    expect(back.intent.motion).toBeNull();
    expect(reasons(back)).toEqual(['intentVague', 'motionUnsure']);
  });

  it('takes “I don’t know” (null), and refuses a slot it doesn’t have', async () => {
    const { run, head, template } = await created();
    expect((await run(N.setMotion, { baseVersion: 1, slotId: template.slots[1]!.id, motion: null })).ok).toBe(
      true,
    );
    expect(reasons((await head()).slots[1]!)).toEqual(['intentVague']);
    const missing = await run(N.setMotion, { baseVersion: 2, slotId: template.id, motion: 'pan' });
    expect(missing.ok ? 'ok' : missing.error.code).toBe('templates.slot_not_found');
  });

  it('keeps the motion doubt with the intent: a text edit leaves it, a split’s halves and a merge carry it', async () => {
    const { run, head, template } = await created();
    const slotId = template.slots[1]!.id;
    await run(N.editIntent, { baseVersion: 1, slotId, intent: { text: 'a person crossing a square' } });
    expect(reasons((await head()).slots[1]!)).toEqual(['motionUnsure']);
    await run(N.editIntent, { baseVersion: 2, slotId, intent: { motion: 'pan' } });
    expect(reasons((await head()).slots[1]!)).toEqual([]);

    const split = await created();
    await split.run(N.splitSlot, { baseVersion: 1, slotId: split.template.slots[1]!.id, at: at(38) });
    const halves = (await split.head()).slots.slice(1, 3);
    expect(halves.map(reasons)).toEqual([
      ['intentVague', 'motionUnsure'],
      ['intentVague', 'motionUnsure'],
    ]);

    const merged = await created();
    const [, second, third] = merged.template.slots;
    await merged.run(N.mergeSlots, {
      baseVersion: 1,
      slotIds: [third!.id, second!.id],
      intentFrom: second!.id,
    });
    const one = (await merged.head()).slots[1]!;
    expect(one.motionMeasure?.label).toBe('pan');
    expect(reasons(one)).toContain('motionUnsure');
  });
});
