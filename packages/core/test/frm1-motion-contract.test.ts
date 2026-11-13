// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** FRM1-MOT's contract (§3): the camera's move, measured, on a template slot and a library shot; template.setMotion. */
import { describe, expect, it } from 'vitest';
import {
  CAMERA_MOTIONS,
  cameraMotionMeasureSchema,
  DOUBT_REASONS,
  newId,
  shotAnalysisSchema,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  templateSchema,
  type CameraMotionMeasure,
  type ShotAnalysis,
  type Template,
} from '@taalcut/core';
import { issuePaths, json, referenceTemplate, span } from './helpers/documents';

const measure: CameraMotionMeasure = {
  panX: 0.21,
  panY: -0.01,
  scale: 0.004,
  rotation: 0,
  jitter: 0.0008,
  subjectSteady: true,
  label: 'tracking',
  confidence: 0.86,
  version: 1,
};

describe('FRM1 camera motion', () => {
  it('keeps the camera motions as they were', () => {
    expect(CAMERA_MOTIONS).toEqual(['static', 'pan', 'tilt', 'push-in', 'pull-out', 'handheld', 'tracking']);
  });

  it('a measure round-trips, with or without a subject, and unsure as a null label', () => {
    expect(cameraMotionMeasureSchema.parse(json(measure))).toEqual(measure);
    const { subjectSteady: _, ...noSubject } = measure;
    expect(cameraMotionMeasureSchema.parse({ ...noSubject, label: null, confidence: 0 })).toEqual({
      ...noSubject,
      label: null,
      confidence: 0,
    });
  });

  it('refuses a measure no camera makes', () => {
    expect(cameraMotionMeasureSchema.safeParse({ ...measure, panX: 40 }).success).toBe(false);
    expect(cameraMotionMeasureSchema.safeParse({ ...measure, jitter: -0.1 }).success).toBe(false);
    expect(cameraMotionMeasureSchema.safeParse({ ...measure, confidence: 1.2 }).success).toBe(false);
    expect(cameraMotionMeasureSchema.safeParse({ ...measure, label: 'zoom' }).success).toBe(false);
    expect(cameraMotionMeasureSchema.safeParse({ ...measure, version: 0 }).success).toBe(false);
  });

  it('a slot carries its measure, and an unsure one a motionUnsure doubt', () => {
    expect(DOUBT_REASONS).toContain('motionUnsure');
    const template: Template = structuredClone(referenceTemplate());
    template.slots[0]!.motionMeasure = measure;
    template.slots[1]!.motionMeasure = { ...measure, label: 'pan', confidence: 0.3 };
    template.slots[1]!.intent = { ...template.slots[1]!.intent, motion: null };
    template.slots[1]!.doubts = [{ reason: 'motionUnsure', confidence: 0.7 }];
    expect(templateSchema.parse(json(template))).toEqual(template);
    const bad = structuredClone(template);
    (bad.slots[0]!.motionMeasure as { label: string }).label = 'whip';
    expect(issuePaths(templateSchema, json(bad))).toContain('slots.0.motionMeasure.label');
  });

  it('a template from before FRM1 has no measure and still parses', () => {
    const template = referenceTemplate();
    expect(template.slots.every((slot) => slot.motionMeasure === undefined)).toBe(true);
    expect(templateSchema.safeParse(json(template)).success).toBe(true);
  });

  it('a library shot carries the same measure', () => {
    const analysis: ShotAnalysis = {
      version: 1,
      range: span(0, 90),
      bestFrame: 10,
      orientation: 'portrait',
      quality: { version: 1, sharpness: 0.8, exposure: 0.9, stability: 0.7, overall: 0.8, flags: [] },
      motion: 'push-in',
      motionMeasure: { ...measure, label: 'push-in', scale: 0.18, subjectSteady: false },
      energy: 0.4,
      onScreenText: [],
      dHash: '0123456789abcdef',
    };
    expect(shotAnalysisSchema.parse(json(analysis))).toEqual(analysis);
    const { motionMeasure: _, ...before } = analysis;
    expect(shotAnalysisSchema.safeParse(json(before)).success).toBe(true);
  });

  it("template.setMotion sets or clears one slot's camera move at a version", () => {
    expect(TEMPLATE_COMMANDS.setMotion).toBe('template.setMotion');
    const schema = templateCommandPayloads[TEMPLATE_COMMANDS.setMotion];
    const base = {
      projectId: null,
      templateId: newId<'Template'>(),
      baseVersion: 2,
      slotId: newId<'TemplateSlot'>(),
    };
    expect(schema.parse({ ...base, motion: 'tilt' }).motion).toBe('tilt');
    expect(schema.parse({ ...base, motion: null }).motion).toBeNull();
    expect(schema.safeParse({ ...base, motion: 'dolly' }).success).toBe(false);
    expect(schema.safeParse({ ...base, motion: 'pan', baseVersion: 0 }).success).toBe(false);
  });
});
