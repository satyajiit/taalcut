// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { GpuSummary } from '@taalcut/core';

/**
 * Whose chip a processor or graphics chip is, for its mark (chip-mark.tsx): the makers Taalcut's builds meet, and
 * `unknown` for the rest. Never their logos (the PO's call, UX3: trademark risk): our own mark, in their colour.
 */
export const CHIP_VENDORS = ['apple', 'intel', 'amd', 'nvidia', 'qualcomm', 'unknown'] as const;
export type ChipVendor = (typeof CHIP_VENDORS)[number];

/** The makers as they write their own names. Product names, never translated. */
/* eslint-disable lingui/no-unlocalized-strings -- the makers' own names */
export const VENDOR_NAMES: Readonly<Record<Exclude<ChipVendor, 'unknown'>, string>> = {
  apple: 'Apple',
  intel: 'Intel',
  amd: 'AMD',
  nvidia: 'NVIDIA',
  qualcomm: 'Qualcomm',
};
/* eslint-enable lingui/no-unlocalized-strings */

/** Words in a chip's name that say whose it is: the maker's name, or a product line only it sells. */
const NAMED: readonly (readonly [ChipVendor, RegExp])[] = [
  ['apple', /\bapple\b/i],
  ['intel', /\bintel\b/i],
  ['amd', /\b(amd|ryzen|threadripper|epyc|athlon|radeon)\b/i],
  ['nvidia', /\b(nvidia|geforce|quadro|tegra)\b/i],
  ['qualcomm', /\b(qualcomm|snapdragon|adreno)\b/i],
];

/** The maker a chip's name gives away ("13th Gen Intel(R) Core(TM) i9-13900K": Intel), else unknown. */
export function vendorOfName(name: string): ChipVendor {
  return NAMED.find(([, words]) => words.test(name))?.[0] ?? 'unknown';
}

/**
 * A graphics chip's maker: the probe's own word when it has one (core's GPU_VENDORS), else its name's (a compute
 * report names the GPU without its vendor; the probe says `other` for a maker it doesn't list, such as Qualcomm).
 */
export function gpuVendorOf(
  gpu: { readonly name: string },
  probed: readonly Pick<GpuSummary, 'name' | 'vendor'>[] = [],
): ChipVendor {
  const vendor = probed.find((each) => each.name === gpu.name)?.vendor;
  if (vendor && vendor !== 'other') return vendor;
  return vendorOfName(gpu.name);
}

/** The maker's name when the chip's own name doesn't already say it ("Snapdragon X Elite": Qualcomm), else null. */
export function vendorNotNamed(name: string, vendor: ChipVendor): string | null {
  if (vendor === 'unknown') return null;
  const maker = VENDOR_NAMES[vendor];
  return name.toLowerCase().includes(maker.toLowerCase()) ? null : maker;
}
