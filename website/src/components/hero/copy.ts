// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The home page's own words (lane L1). Every line is in the truth ledger's "Say" column; test/unit/demo-copy.test.ts
 * runs them through the claims ledger. Words other pages share stay in src/content.
 */

export const HERO = {
  title: 'Every reel you save becomes one you can make.',
  /** The h1's three lines on a wide screen (they join, with spaces, into `title`). */
  titleLines: ['Every reel you', 'save becomes', 'one you can make.'],
  /** The line under the h1: its first part on a phone (two lines at 390 px), the whole of it from 640 px. */
  lead: ['Paste a reel you love. Taalcut makes yours from your camera roll', ', on the same music beats', '.'],
  platforms: 'Platforms',
  /** Each OS by its own name beside its SVGL icon, and what it needs or when it comes. */
  platformRow: [
    { brand: 'apple', name: 'macOS', note: 'Apple silicon' },
    { brand: 'ubuntu', name: 'Ubuntu', note: '24.04' },
    { brand: 'windows', name: 'Windows', note: 'after 1.0' },
  ],
} as const;

/**
 * The signature interaction's words: the reel, its stickers, and the coded app window's Make page. The status line
 * follows the pass; the live region says each step once (never per beat).
 */
export const DEMO = {
  savedReel: (title: string) => `A saved reel: ${title}`,
  yourReel: (title: string) => `Your version of ${title}, made from your camera roll`,
  useTemplate: 'Use template',
  views: { saved: 'Saved reel', yours: 'Your version' },
  viewGroup: 'Show on the reel',
  reels: 'Saved reels',
  stickers: {
    beats: (n: number) => `${n} music beats`,
    slots: (n: number) => `${n} slots`,
    yours: 'Your version',
  },
  page: 'Remix a reel',
  noTemplate: 'No template yet',
  empty: 'Use template on a saved reel and its slots land here.',
  roll: 'Camera roll',
  clips: (count: string) => `${count} clips`,
  slots: 'Slots',
  slot: (n: number) => `Slot ${n}`,
  /** A row's heading: the slot's number and its part ("Slot 1 · Hook"). */
  slotTitle: (n: number, part: string) => `Slot ${n} · ${part}`,
  /** The music beats a slot covers. */
  beats: (first: number, last: number) => (first === last ? `Beat ${first}` : `Beats ${first}–${last}`),
  areas: 'Areas',
  /** The reel's own audio, as Reels names it under the caption. */
  audio: 'Original audio',
  aiPick: 'AI pick',
  otherShots: (n: number) => `${n} other ${n === 1 ? 'shot' : 'shots'}`,
  waiting: 'Waiting for a clip',
  approve: 'Approve',
  approved: 'Approved',
  status: {
    shelf: 'Waiting for a template',
    lift: 'Taking the template',
    template: 'Finding cuts and music beats',
    sift: (count: string) => `Searching ${count} clips`,
    assembled: (n: number, total: number) => `Picking clips: ${n} of ${total}`,
    ready: (total: number) => `All ${total} slots filled`,
    approved: 'Your version is on the reel',
  },
  live: {
    template: (slots: number) => `Template taken: ${slots} slots.`,
    sift: (beats: number, count: string) => `${beats} music beats found. Searching ${count} clips in your camera roll.`,
    assembled: 'Picking a clip for each slot.',
    ready: 'Every slot has a clip. Approve is ready.',
    approved: 'Approved. The reel plays your version.',
  },
} as const;
