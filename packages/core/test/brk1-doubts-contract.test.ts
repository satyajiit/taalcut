// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** BRK1-ACC's contract (§1): what the breakdown isn't sure of, on slots, on text and on the template. */
import { describe, expect, it } from 'vitest';
import { DOUBT_REASONS, doubtSchema, templateSchema, type Doubt, type Template } from '@taalcut/core';
import { issuePaths, json, referenceTemplate } from './helpers/documents';

function withDoubts(): Template {
  const template = structuredClone(referenceTemplate());
  template.slots[1]!.doubts = [{ reason: 'cutMaybeTransition', confidence: 0.4 }, { reason: 'intentVague' }];
  template.text[0]!.doubts = [{ reason: 'textMaybeScene', confidence: 0.55 }];
  template.doubts = [{ reason: 'tempoMaybeHalfOrDouble', confidence: 0.3 }, { reason: 'soundCreditMissing' }];
  return template;
}

describe('BRK1 doubts', () => {
  it('names the reasons the review asks about (FRM1-MOT added motionUnsure, AGT1 intentGeneralised)', () => {
    expect(DOUBT_REASONS).toEqual([
      'cutUnsure',
      'cutMaybeTransition',
      'fadeTail',
      'intentVague',
      'intentGeneralised',
      'motionUnsure',
      'textMaybeScene',
      'speechMaybeHallucinated',
      'tempoMaybeHalfOrDouble',
      'soundCreditMissing',
    ]);
  });

  it('a doubt has a reason and an optional confidence', () => {
    const doubt: Doubt = { reason: 'fadeTail' };
    expect(doubtSchema.parse(doubt)).toEqual(doubt);
    expect(doubtSchema.parse({ reason: 'cutUnsure', confidence: 0.2 })).toEqual({
      reason: 'cutUnsure',
      confidence: 0.2,
    });
    expect(doubtSchema.safeParse({ reason: 'maybe' }).success).toBe(false);
    expect(doubtSchema.safeParse({ reason: 'cutUnsure', confidence: 1.5 }).success).toBe(false);
  });

  it('a template made before BRK1 parses unchanged, with no doubts', () => {
    const template = referenceTemplate();
    const parsed = templateSchema.parse(json(template));
    expect(parsed).toEqual(template);
    expect(parsed.doubts).toBeUndefined();
    expect(parsed.slots.every((slot) => slot.doubts === undefined)).toBe(true);
    expect(parsed.text.every((overlay) => overlay.doubts === undefined)).toBe(true);
  });

  it('slots, text overlays and the template carry their doubts through a round trip', () => {
    const template = withDoubts();
    const parsed = templateSchema.parse(json(template));
    expect(parsed).toEqual(template);
    expect(json(parsed)).toEqual(json(template));
  });

  it('refuses an unknown reason and more doubts than there are reasons', () => {
    const unknown = json(withDoubts()) as { slots: { doubts: unknown[] }[] };
    unknown.slots[1]!.doubts = [{ reason: 'blurry' }];
    expect(issuePaths(templateSchema, unknown)).toContainEqual('slots.1.doubts.0.reason');

    const many = withDoubts();
    many.doubts = Array.from({ length: DOUBT_REASONS.length + 1 }, () => ({ reason: 'cutUnsure' as const }));
    expect(issuePaths(templateSchema, json(many))).toContainEqual('doubts');
  });
});
