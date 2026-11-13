// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-ONB: the makers' chip marks. Our own chip drawing in each maker's colour (never their logos), the maker named
// in words beside it, and each colour at WCAG AA non-text contrast (3:1) on every surface of its theme.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChipMark, TONE_CLASS, VENDOR_TONES } from '../../src/features/hardware/chip-mark';
import { gpuVendorOf, vendorNotNamed, vendorOfName } from '../../src/features/hardware/chip-vendor';
import designTokens from '../../../../design/tokens/tokens.json';

type Tokens = { color: Record<'light' | 'dark', Record<string, { $value: { hex: string } }>> };
const tokens = designTokens as unknown as Tokens;

/** WCAG 2's relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
};

describe('whose chip it is', () => {
  it.each([
    ['Apple M2 Pro', 'apple'],
    ['13th Gen Intel(R) Core(TM) i9-13900K', 'intel'],
    ['Intel(R) Core(TM) Ultra 7 155H', 'intel'],
    ['AMD Ryzen 9 7950X 16-Core Processor', 'amd'],
    ['AMD Radeon RX 7900 XTX', 'amd'],
    ['NVIDIA GeForce RTX 4090', 'nvidia'],
    ['NVIDIA GA102 [GeForce RTX 3080]', 'nvidia'],
    ['Snapdragon(R) X Elite - X1E78100 - Qualcomm(R) Oryon(TM) CPU', 'qualcomm'],
    ['Qualcomm Adreno X1-85', 'qualcomm'],
    ['ARM Cortex-A78', 'unknown'],
    ['', 'unknown'],
  ])('%s: %s', (name, vendor) => {
    expect(vendorOfName(name)).toBe(vendor);
  });

  it('a GPU: the probe’s own word first, its name when the probe says other or has no row for it', () => {
    expect(
      gpuVendorOf({ name: 'Intel UHD Graphics 770' }, [{ name: 'Intel UHD Graphics 770', vendor: 'intel' }]),
    ).toBe('intel');
    expect(gpuVendorOf({ name: 'Adreno X1-85' }, [{ name: 'Adreno X1-85', vendor: 'other' }])).toBe(
      'qualcomm',
    );
    expect(gpuVendorOf({ name: 'Apple M2 Pro' })).toBe('apple');
    expect(gpuVendorOf({ name: 'Some GPU' }, [{ name: 'Some GPU', vendor: 'other' }])).toBe('unknown');
  });

  it('names the maker in words only where the chip’s name doesn’t already', () => {
    expect(vendorNotNamed('Snapdragon X Elite', 'qualcomm')).toBe('Qualcomm');
    expect(vendorNotNamed('GeForce RTX 3080', 'nvidia')).toBe('NVIDIA');
    expect(vendorNotNamed('13th Gen Intel(R) Core(TM) i9-13900K', 'intel')).toBeNull();
    expect(vendorNotNamed('Mystery chip', 'unknown')).toBeNull();
  });
});

describe('the makers’ colours', () => {
  const surfaces = ['canvas', 'raised', 'sunken', 'hover'] as const;
  for (const theme of ['light', 'dark'] as const)
    it.each(Object.entries(VENDOR_TONES))(`${theme}: %s keeps 3:1 on every surface`, (_vendor, tones) => {
      for (const surface of surfaces) {
        const ratio = contrast(tones[theme], tokens.color[theme][surface]!.$value.hex);
        expect(ratio, `${tones[theme]} on ${theme} ${surface}`).toBeGreaterThanOrEqual(3);
      }
    });

  it('the classes Tailwind sees are the same colours', () => {
    for (const [vendor, tones] of Object.entries(VENDOR_TONES))
      expect(TONE_CLASS[vendor as keyof typeof VENDOR_TONES]).toBe(
        `text-[${tones.light}] dark:text-[${tones.dark}]`,
      );
    expect(TONE_CLASS.unknown).toBe('text-ink-3');
  });

  it('one drawing for every maker: a known maker’s die is filled, an unknown one’s hollow', () => {
    const { container, rerender } = render(<ChipMark vendor="nvidia" className="size-10" />);
    const svg = () => container.querySelector('svg')!;
    expect(svg().getAttribute('data-vendor')).toBe('nvidia');
    expect(svg().getAttribute('aria-hidden')).toBe('true');
    expect(svg().getAttribute('class')).toContain('text-[#4a7a00]');
    expect(svg().querySelectorAll('rect')[1]!.getAttribute('fill')).toBe('currentColor');
    rerender(<ChipMark vendor="unknown" />);
    expect(svg().getAttribute('class')).toContain('text-ink-3');
    expect(svg().querySelectorAll('rect')[1]!.getAttribute('fill')).toBe('none');
  });
});
