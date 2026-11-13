// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, it } from 'vitest';
import { productPreferencesSchema } from '../src/products/product-schema';

it('bounds API product durations to the supported 5–179 seconds while preserving 60fps', () => {
  const at = (value: number) => ({ duration: { value, rate: { num: 60, den: 1 } } });
  for (const value of [-60, 0, 299, 10_741, 10_800])
    expect(productPreferencesSchema.safeParse(at(value)).success).toBe(false);
  for (const value of [300, 2700, 10_740]) {
    const preferences = productPreferencesSchema.parse(at(value));
    expect(preferences.duration).toEqual(at(value).duration);
    expect(preferences.fps).toBe(60);
  }
  expect(productPreferencesSchema.parse({}).duration).toEqual(at(2700).duration);
  expect(productPreferencesSchema.safeParse({ ...at(2700), fps: 30 }).success).toBe(false);
});

it('compares durations as rationals instead of treating a frame count as seconds', () => {
  expect(
    productPreferencesSchema.safeParse({ duration: { value: 150, rate: { num: 30, den: 1 } } }).success,
  ).toBe(true);
  expect(
    productPreferencesSchema.safeParse({ duration: { value: 149, rate: { num: 30, den: 1 } } }).success,
  ).toBe(false);
  expect(
    productPreferencesSchema.safeParse({ duration: { value: 5371, rate: { num: 30, den: 1 } } }).success,
  ).toBe(false);
});
