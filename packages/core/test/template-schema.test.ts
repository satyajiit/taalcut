// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Template v1 (P2-T1): fixtures round-trip, and every invariant fails with its path. */
import { describe, expect, it } from 'vitest';
import {
  FrameRates,
  slotIntentPatchSchema,
  slotIntentSchema,
  templateRefSchema,
  templateSchema,
  type Template,
} from '@taalcut/core';
import { at, formatTemplate, issuePaths, json, manualTemplate, referenceTemplate } from './helpers/documents';

const paths = (template: Template) => issuePaths(templateSchema, json(template));

function edit(change: (template: Template) => void): Template {
  const template = structuredClone(referenceTemplate());
  change(template);
  return template;
}

describe('Template v1', () => {
  it.each([
    ['reference', referenceTemplate],
    ['format', formatTemplate],
    ['manual', manualTemplate],
  ])('a %s template parses and serialises unchanged', (_name, make) => {
    const template = make();
    const parsed = templateSchema.parse(json(template));
    expect(parsed).toEqual(template);
    expect(json(parsed)).toEqual(json(template));
  });

  it('refers to a version', () => {
    const template = referenceTemplate();
    expect(templateRefSchema.parse({ id: template.id, version: 2 })).toEqual({ id: template.id, version: 2 });
    expect(templateRefSchema.safeParse({ id: template.id, version: 0 }).success).toBe(false);
  });

  it.each<[string, (template: Template) => void, string]>([
    ['non-contiguous slots', (t) => void (t.slots[1]!.start = at(31)), 'slots.1.start'],
    ['mixed rates', (t) => void (t.slots[0]!.duration = at(25, FrameRates.fps25)), 'slots.0.duration'],
    ['a zero-length slot', (t) => void (t.slots[2]!.duration = at(0)), 'slots.2.duration'],
    ['slots that end early', (t) => void (t.duration = at(120)), 'duration'],
    [
      'a bad anchor',
      (t) => void (t.slots[1]!.beatAnchor = { beatIndex: 3, offset: at(0) }),
      'slots.1.beatAnchor',
    ],
    [
      'an anchor on no beat',
      (t) => void (t.slots[1]!.beatAnchor = { beatIndex: 40, offset: at(0) }),
      'slots.1.beatAnchor.beatIndex',
    ],
    ['an overlay past the end', (t) => void (t.text[0]!.start = at(80)), 'text.0'],
    ['a zero-length overlay', (t) => void (t.text[0]!.duration = at(0)), 'text.0.duration'],
    ['an overlay on no slot', (t) => void (t.text[0]!.slotId = t.id as never), 'text.0.slotId'],
    [
      'a transition on slot 0',
      (t) => void (t.slots[0]!.transitionIn = t.slots[1]!.transitionIn),
      'slots.0.transitionIn',
    ],
    [
      'a transition longer than its slot',
      (t) => void (t.slots[1]!.transitionIn!.after = at(31)),
      'slots.1.transitionIn.after',
    ],
    [
      'a transition longer than the slot before',
      (t) => void (t.slots[1]!.transitionIn!.before = at(31)),
      'slots.1.transitionIn.before',
    ],
    ['an unknown downbeat index', (t) => void (t.beatMap!.downbeats = [0, 9]), 'beatMap.downbeats.1'],
    ['downbeats out of order', (t) => void (t.beatMap!.downbeats = [4, 0]), 'beatMap.downbeats.1'],
    ['beats out of order', (t) => void (t.beatMap!.beats[2] = t.beatMap!.beats[1]!), 'beatMap.beats.2'],
    ['a parentless version 2', (t) => void (t.version = 2), 'parentVersion'],
    ['a parent on version 1', (t) => void (t.parentVersion = 1), 'parentVersion'],
    [
      'a ramp not starting at zero',
      (t) => void (t.slots[2]!.speedRamp!.points[0]!.at = at(1)),
      'slots.2.speedRamp.points.0.at',
    ],
    [
      'a ramp past its slot',
      (t) => void (t.slots[2]!.speedRamp!.points[1]!.at = at(31)),
      'slots.2.speedRamp.points.1.at',
    ],
    [
      'a ramp that goes back',
      (t) => void (t.slots[2]!.speedRamp!.points[1]!.at = at(0)),
      'slots.2.speedRamp.points.1.at',
    ],
    ['a shot count that disagrees', (t) => void (t.pacing.shotCount = 4), 'pacing.shotCount'],
    ['pacing at another rate', (t) => void (t.pacing.hookEnd = at(1, FrameRates.fps25)), 'pacing.hookEnd'],
    ['a slot frame with no tile', (t) => void (t.slots[0]!.frame = 3), 'slots.0.frame'],
    [
      'more sheet frames than tiles',
      (t) => void t.contactSheet!.frames.push(t.contactSheet!.frames[0]!),
      'contactSheet.frames',
    ],
    [
      'a sheet frame on no slot',
      (t) => void (t.contactSheet!.frames[0]!.slotId = t.id as never),
      'contactSheet.frames.0.slotId',
    ],
    ['a duplicate slot id', (t) => void (t.slots[1]!.id = t.slots[0]!.id), 'slots.1.id'],
  ])('rejects %s', (_name, change, path) => {
    expect(paths(edit(change))).toContain(path);
  });

  it('allows a later version with an earlier parent', () => {
    expect(paths(edit((t) => Object.assign(t, { version: 3, parentVersion: 2 })))).toEqual([]);
  });

  it('wants intent text once an intent is written, and a non-empty patch', () => {
    const pending = { ...referenceTemplate().slots[0]!.intent, text: '', source: 'pending' as const };
    expect(slotIntentSchema.safeParse(pending).success).toBe(true);
    expect(issuePaths(slotIntentSchema, { ...pending, source: 'user' })).toEqual(['text']);
    expect(slotIntentPatchSchema.safeParse({}).success).toBe(false);
    expect(slotIntentPatchSchema.parse({ text: ' a close-up ' })).toEqual({ text: 'a close-up' });
  });

  it('takes what a slot needs and whether it shows the face, and parses an intent without them as before', () => {
    const intent = referenceTemplate().slots[0]!.intent;
    expect(slotIntentSchema.parse(intent)).not.toHaveProperty('needs');
    const stated = {
      ...intent,
      needs: [' a ball in the air ', 'a hand catching it'],
      face: 'hidden' as const,
    };
    expect(slotIntentSchema.parse(stated)).toMatchObject({
      needs: ['a ball in the air', 'a hand catching it'],
      face: 'hidden',
    });
    expect(slotIntentSchema.safeParse({ ...intent, face: null }).success).toBe(true);
    expect(issuePaths(slotIntentSchema, { ...intent, needs: ['a', 'b', 'c', 'd'] })).toEqual(['needs']);
    expect(issuePaths(slotIntentSchema, { ...intent, needs: ['x'.repeat(81)] })).toEqual(['needs.0']);
    expect(issuePaths(slotIntentSchema, { ...intent, face: 'side' })).toEqual(['face']);
    expect(slotIntentPatchSchema.parse({ needs: ['a ball'] })).toEqual({ needs: ['a ball'] });
  });

  it('refuses a link that is not https and a box that leaves the frame', () => {
    const insecure = edit((t) => {
      if (t.origin.kind === 'reference') t.origin.url = 'http://example.com/reel';
    });
    expect(paths(insecure)).toContain('origin.url');
    expect(paths(edit((t) => void (t.text[0]!.box.x = 0.5)))).toContain('text.0.box');
  });
});
