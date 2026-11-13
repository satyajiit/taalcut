// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect } from 'vitest';
import { templateSchema, type FormatId, type Template, type TemplateSlot } from '@taalcut/core';
import { planFormat, type TemplateIds } from '../../src/index';
import { json, sequentialIds } from '../helpers/fixtures';

/** The cross-post safe rect on a 1080 × 1920 canvas, same numbers as the vlog test. */
export const SAFE = { left: 120 / 1080, top: 288 / 1920, right: 780 / 1080, bottom: 1248 / 1920 };

/** Fixed ULIDs from a counter, so two runs make identical documents. */
export function countingIds(): TemplateIds {
  const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let n = 0;
  const next = <T>() => {
    let value = n++;
    let tail = '';
    for (let i = 0; i < 8; i++, value = Math.floor(value / 32)) tail = crockford[value % 32] + tail;
    return `01HZZZZZZZZZZZZZZZ${tail}` as T;
  };
  return { template: next, slot: next, overlay: next };
}

export function requirePlan(
  formatId: FormatId,
  seconds: number,
  ids: TemplateIds = sequentialIds(),
): Template {
  const result = planFormat({ formatId, targetSeconds: seconds, createdAt: 5 }, ids);
  expect(result.ok, result.ok ? '' : result.error.detail).toBe(true);
  if (!result.ok) throw new Error(result.error.detail ?? result.error.code);
  return result.value;
}

export function sectionNames(template: Template): string[] {
  return template.slots.map((slot) => slot.intent.text.split(':')[0] ?? '');
}

/** Beats whose frame falls in the slot. The last slot owns every beat from its start. */
export function slotBeatCounts(template: Template): number[] {
  const marks = template.beatMap?.beats.map((beat) => beat.value) ?? [];
  return template.slots.map((slot, index) => {
    const start = slot.start.value;
    const end = template.slots[index + 1]?.start.value;
    return marks.filter((frame) => frame >= start && (end === undefined || frame < end)).length;
  });
}

export function expectPlanBasics(
  template: Template,
  formatId: FormatId,
  seconds: number,
  audio: 'music' | 'voice',
): void {
  expect(templateSchema.safeParse(json(template)).success).toBe(true);
  expect(template.duration.value).toBe(seconds * 30);
  expect(template.canvas.rate).toEqual({ num: 30, den: 1 });
  expect(template.origin).toMatchObject({ kind: 'format', formatId, brief: null });
  expect(template.audio).toEqual({
    kind: audio,
    loudnessLufs: null,
    sound: null,
    speech: null,
    waveform: null,
  });
  expect(template.pacing.cutsOnBeat).toBe(1);
  expect(template.contactSheet).toBeNull();
  const marks = template.beatMap?.beats.map((beat) => beat.value) ?? [];
  expect(slotBeatCounts(template).reduce((total, beats) => total + beats, 0)).toBe(marks.length);
  for (const slot of template.slots) {
    expect(marks).toContain(slot.start.value);
    expect(slot.beatAnchor?.offset.value).toBe(0);
    expect(slot.cut).toEqual({ method: 'format', confidence: 1 });
    expect(slot.intent.source).toBe('format');
    expect(slot.approved).toBe(false);
    expect(slot.frame).toBeNull();
    expect(slot.intent.place).toBeNull();
  }
  const hook = template.slots[0];
  expect(hook?.role).toBe('hook');
  expect(hook?.duration.value).toBeLessThanOrEqual(45);
  for (const item of template.text) {
    expect(item.box.x).toBeGreaterThanOrEqual(SAFE.left);
    expect(item.box.y).toBeGreaterThanOrEqual(SAFE.top);
    expect(item.box.x + item.box.width).toBeLessThanOrEqual(SAFE.right);
    expect(item.box.y + item.box.height).toBeLessThanOrEqual(SAFE.bottom);
  }
}

export function beatsOf(template: Template, prefix: string): number[] {
  const counts = slotBeatCounts(template);
  return template.slots.flatMap((slot, index) =>
    slot.intent.text.startsWith(prefix) ? [counts[index] ?? 0] : [],
  );
}

export function slotsNamed(template: Template, prefix: string): TemplateSlot[] {
  return template.slots.filter((slot) => slot.intent.text.startsWith(prefix));
}

export function textOn(template: Template, placeholder: string): Template['text'] {
  return template.text.filter((item) => item.text === placeholder);
}
