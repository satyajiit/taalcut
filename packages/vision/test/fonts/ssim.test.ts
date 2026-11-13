// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Mean SSIM: identical images, a constant, and the 11×11 black/white floor. */
import { describe, expect, it } from 'vitest';
import { meanSsim } from '../../src/fonts/ssim';

function ramp(width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = (i * 17) % 256;
  return gray;
}

describe('meanSsim', () => {
  it('scores identical images as 1', () => {
    const img = { gray: ramp(32, 24), width: 32, height: 24 };
    expect(meanSsim(img, img)).toBe(1);
  });

  it('scores a constant image against itself as 1', () => {
    const img = { gray: new Uint8Array(16 * 16).fill(40), width: 16, height: 16 };
    expect(meanSsim(img, img)).toBe(1);
  });

  it('scores 255 against 0 at the 11×11 constant-image floor', () => {
    const n = 11 * 11;
    const white = { gray: new Uint8Array(n).fill(255), width: 11, height: 11 };
    const black = { gray: new Uint8Array(n).fill(0), width: 11, height: 11 };
    // Variances and covariance are 0, so C2 cancels: (C1) / (L² + C1), L = 255, K1 = 0.01.
    const c1 = (0.01 * 255) ** 2;
    const expected = c1 / (255 * 255 + c1);
    expect(Math.abs(meanSsim(white, black) - expected)).toBeLessThan(1e-4);
  });

  it('scores different images below an identical pair', () => {
    const flat = { gray: new Uint8Array(20 * 20).fill(30), width: 20, height: 20 };
    const other = new Uint8Array(20 * 20);
    for (let i = 0; i < other.length; i++) other[i] = i % 2 === 0 ? 30 : 220;
    expect(meanSsim(flat, { gray: other, width: 20, height: 20 })).toBeLessThan(meanSsim(flat, flat));
  });
});
