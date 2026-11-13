// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-FIND: what people in a shot are doing, and the filter by it. */
import { describe, expect, it } from 'vitest';
import {
  actionCountSchema,
  libraryContract,
  libraryFiltersSchema,
  newId,
  SHOT_ACTION_LIMITS,
  SHOT_ACTIONS,
  shotActionSchema,
  shotAnalysisSchema,
  shotDescriptionSchema,
} from '@taalcut/core';

const description = {
  text: 'Two people dance on a beach at sunset.',
  objects: ['beach', 'sea', 'sky'],
  shotType: 'wide',
  people: 2,
  model: { provider: 'local', model: 'qwen3.5-4b', local: true },
} as const;

describe('SHOT_ACTIONS', () => {
  it('is about forty distinct lowercase words, each a stored action', () => {
    expect(SHOT_ACTIONS.length).toBe(40);
    expect(new Set(SHOT_ACTIONS).size).toBe(SHOT_ACTIONS.length);
    for (const action of SHOT_ACTIONS) {
      expect(action).toBe(action.toLowerCase());
      expect(shotActionSchema.safeParse(action).success).toBe(true);
    }
  });
});

describe('ShotDescription.actions', () => {
  it('takes fixed and free words, in any script that has them', () => {
    const parsed = shotDescriptionSchema.safeParse({
      ...description,
      actions: ['dancing', 'celebrating', 'doing the bhangra', 'नाचना'],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.actions).toEqual(['dancing', 'celebrating', 'doing the bhangra', 'नाचना']);
  });

  it('refuses uppercase, markup, overlong words and more than the cap', () => {
    for (const bad of ['Dancing', '<b>dancing</b>', 'x'.repeat(SHOT_ACTION_LIMITS.chars + 1), ''])
      expect(shotDescriptionSchema.safeParse({ ...description, actions: [bad] }).success).toBe(false);
    const many = Array.from({ length: SHOT_ACTION_LIMITS.count + 1 }, (_, n) => `moving ${n}`);
    expect(shotDescriptionSchema.safeParse({ ...description, actions: many }).success).toBe(false);
  });

  it('is optional: a description stored before LIB1 still parses, inside an analysis too', () => {
    expect(shotDescriptionSchema.safeParse(description).success).toBe(true);
    const analysis = {
      version: 1,
      range: {
        start: { value: 0, rate: { num: 30, den: 1 } },
        duration: { value: 158, rate: { num: 30, den: 1 } },
      },
      bestFrame: 40,
      orientation: 'portrait',
      quality: { version: 1, sharpness: 0.7, exposure: 0.8, stability: 0.6, overall: 0.7, flags: [] },
      energy: 0.36,
      onScreenText: [],
      dHash: '0123456789abcdef',
      description,
    };
    expect(shotAnalysisSchema.safeParse(analysis).success).toBe(true);
    const withActions = { ...analysis, description: { ...description, actions: ['dancing'] } };
    expect(shotAnalysisSchema.parse(withActions).description?.actions).toEqual(['dancing']);
  });
});

describe('LibraryFilters.actions', () => {
  it('names one to ten actions', () => {
    expect(libraryFiltersSchema.safeParse({ actions: ['dancing'] }).success).toBe(true);
    expect(libraryFiltersSchema.safeParse({ actions: [] }).success).toBe(false);
    expect(libraryFiltersSchema.safeParse({ actions: Array(11).fill('dancing') }).success).toBe(false);
    expect(libraryFiltersSchema.safeParse({}).success).toBe(true);
  });
});

describe('LibraryFilters by place and trip', () => {
  it('names one to twenty trips, countries or cities', () => {
    const trip = newId<'Trip'>();
    expect(libraryFiltersSchema.safeParse({ tripIds: [trip] }).success).toBe(true);
    expect(libraryFiltersSchema.safeParse({ countries: ['PT', 'BR'], cityIds: [2267057] }).success).toBe(
      true,
    );
    expect(libraryFiltersSchema.safeParse({ tripIds: [] }).success).toBe(false);
    expect(libraryFiltersSchema.safeParse({ countries: ['Portugal'] }).success).toBe(false);
    expect(libraryFiltersSchema.safeParse({ countries: Array(21).fill('PT') }).success).toBe(false);
    expect(libraryFiltersSchema.safeParse({ cityIds: [0] }).success).toBe(false);
  });
});

describe('actionCountSchema', () => {
  it('is an action with the clips that show it', () => {
    expect(actionCountSchema.safeParse({ action: 'dancing', assets: 3 }).success).toBe(true);
    expect(actionCountSchema.safeParse({ action: 'dancing', assets: 0 }).success).toBe(false);
  });
});

describe('library.actions', () => {
  it('answers the actions with their clip counts, at most ACTION_COUNTS_MAX', () => {
    const output = libraryContract.actions['~orpc'].outputSchema!;
    expect(output['~standard'].validate({ actions: [{ action: 'dancing', assets: 2 }] })).toEqual({
      value: { actions: [{ action: 'dancing', assets: 2 }] },
    });
    const many = Array.from({ length: 101 }, (_, n) => ({ action: `moving ${n}`, assets: 1 }));
    expect('issues' in (output['~standard'].validate({ actions: many }) as object)).toBe(true);
  });
});
