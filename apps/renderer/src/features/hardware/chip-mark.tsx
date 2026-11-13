// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: chip mark · genre: atmospheric studio app · system: DESIGN.md v0.6 (UX3)
 * our own drawing of a chip (a body with three pins a side and its die), one mark for every maker, tinted in the
 *   maker's colour; never the maker's logo (the PO's call: trademark risk). The colour is never the only sign: the
 *   maker's name is always in words beside it. An unknown maker gets the same chip in ink-3 with a hollow die.
 * states: n/a (a still picture, aria-hidden); one tone per theme
 */
import { cn } from '@taalcut/ui';
import { CHIP_VENDORS, type ChipVendor } from './chip-vendor';

/**
 * The makers' colours, toned per theme so a mark's outline keeps WCAG AA non-text contrast (3:1; each reaches 4.1:1
 * or more) on every surface it sits on in that theme (canvas, raised, sunken, hover). They live here and nowhere
 * else on purpose: they are the makers' colours, not Taalcut's tokens (test/hardware/chip-mark.test.ts holds them
 * to the ratio and to TONE_CLASS).
 */
export const VENDOR_TONES: Readonly<Record<Exclude<ChipVendor, 'unknown'>, { light: string; dark: string }>> =
  {
    // Apple's own mark is black, or white on dark.
    apple: { light: '#1d1d1f', dark: '#f5f5f7' },
    // Intel's Classic Blue, then its Energy Blue on dark.
    intel: { light: '#0068b5', dark: '#00c7fd' },
    // AMD's red, deepened for paper and lifted for the night.
    amd: { light: '#d4111e', dark: '#ff5a5f' },
    // NVIDIA's green is too light for paper (2.2:1): an olive of the same hue there.
    nvidia: { light: '#4a7a00', dark: '#76b900' },
    // Qualcomm's blue, lifted on dark.
    qualcomm: { light: '#3253dc', dark: '#7b93ff' },
  };

/** The same, as classes Tailwind can see: written out in full, one per maker. */
/* eslint-disable lingui/no-unlocalized-strings -- class names */
export const TONE_CLASS: Readonly<Record<ChipVendor, string>> = {
  apple: 'text-[#1d1d1f] dark:text-[#f5f5f7]',
  intel: 'text-[#0068b5] dark:text-[#00c7fd]',
  amd: 'text-[#d4111e] dark:text-[#ff5a5f]',
  nvidia: 'text-[#4a7a00] dark:text-[#76b900]',
  qualcomm: 'text-[#3253dc] dark:text-[#7b93ff]',
  unknown: 'text-ink-3',
};
/* eslint-enable lingui/no-unlocalized-strings */

/** Three pins a side, at the body's quarter points. */
const PINS = [8.5, 12, 15.5];

/** A chip in the maker's colour. Size it with a class (`size-10` in first run, `size-4` in a line of text). */
export function ChipMark({ vendor, className }: { vendor: ChipVendor; className?: string }) {
  const known = vendor !== 'unknown';
  return (
    <svg
      aria-hidden
      data-slot="chip-mark"
      data-vendor={CHIP_VENDORS.includes(vendor) ? vendor : 'unknown'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      className={cn('shrink-0', TONE_CLASS[vendor], className)}
    >
      {PINS.map((at) => (
        <g key={at}>
          <path d={`M${at} 2v2.5M${at} 19.5V22M2 ${at}h2.5M19.5 ${at}H22`} />
        </g>
      ))}
      <rect x={4.5} y={4.5} width={15} height={15} rx={3} fill="currentColor" fillOpacity={0.12} />
      <rect
        x={8.5}
        y={8.5}
        width={7}
        height={7}
        rx={1.5}
        fill={known ? 'currentColor' : 'none'}
        stroke={known ? 'none' : 'currentColor'}
      />
    </svg>
  );
}
