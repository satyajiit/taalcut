// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-pick's golden set and scorer (EAR1-B2), without models: 60 queries whose families exist, every bank
 * category in one family, and the bar read from ci-paths.json.
 */
import { describe, expect, it } from 'vitest';
import { pickLabels } from './fixtures';
import { familyOf, PICK_FAMILIES, PICK_FAMILY_NAMES } from './families';
import { scorePick } from './run';
import type { PickPrediction } from './schema';
import { PICK_BAR } from './threshold';

describe('listen-pick', () => {
  it('has 60 unique queries over the 22 documented families', () => {
    const labels = pickLabels();
    expect(labels).toHaveLength(60);
    expect(new Set(labels.map((l) => l.query)).size).toBe(60);
    expect(new Set(labels.flatMap((l) => l.families))).toEqual(new Set(PICK_FAMILY_NAMES));
    expect(PICK_FAMILY_NAMES).toHaveLength(22);
  });

  it("maps earshot's categories and fitted roles (folded ids too) to families", () => {
    expect(familyOf('pro_click', 'pro_click/glass')).toBe('click');
    expect(familyOf('cut_hit', 'cut_hit/sub')).toBe('impact');
    expect(familyOf('fit', 'fit/land.light/finger_phone')).toBe('tap');
    expect(familyOf('fit', 'fit/land_light_finger_phone')).toBe('tap');
    expect(familyOf('fit', 'fit/key_space_thock_space')).toBe('key');
    expect(familyOf('fit', 'fit/whoosh_short_bamboo_swish')).toBe('whoosh');
    const categories = Object.values(PICK_FAMILIES).flatMap((f) => [...f.categories]);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it('passes a query when any of its top 5 is of an accepted family, gated at the ci-paths bar', () => {
    const labels = pickLabels().slice(0, 2);
    const pick = (soundId: string, category: string) => ({ soundId, category, upstreamId: soundId });
    const predictions = new Map<string, PickPrediction>([
      [
        'q01',
        {
          caseId: 'q01',
          top: [pick('typing_key/thock', 'typing_key'), pick('click/soft', 'click')],
          audioTop: [pick('typing_key/thock', 'typing_key')],
          dtype: 'fp16',
        },
      ],
      ['q02', { caseId: 'q02', top: [pick('typing_key/deep', 'typing_key')], audioTop: [], dtype: 'fp16' }],
    ]);
    const report = scorePick(labels, predictions);
    expect(report.cases.map((c) => [c.hit, c.audioHit])).toEqual([
      [true, false],
      [false, false],
    ]);
    expect(report.metrics[0]).toMatchObject({ name: 'top5FamilyRate', value: 0.5 });
    expect(report.gate.pass).toBe(false);
    expect(PICK_BAR.top5FamilyRate).toBe(0.85);
  });
});
