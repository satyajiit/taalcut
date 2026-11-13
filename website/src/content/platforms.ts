// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Platform, PlatformId } from './schema';

/**
 * Platforms (apps/desktop/packaging: a .dmg for arm64, a .deb for x64). Nothing is released yet, so every platform
 * joins the waitlist. Ubuntu is 24.04 only: 22.04 has never been run. The 8 GB and 20 GB are recommendations.
 */
export const PLATFORMS: readonly Platform[] = [
  {
    id: 'macos',
    name: 'macOS',
    status: 'supported',
    line: 'Made for Apple silicon. Metal, Core ML and the Neural Engine do the work, on your Mac.',
    requirements: [
      ['System', 'macOS 14 Sonoma or later'],
      ['Chip', 'Apple silicon, M1 or later'],
      ['Memory', '8 GB or more recommended'],
      ['Space', '20 GB free recommended'],
    ],
  },
  {
    id: 'ubuntu',
    name: 'Ubuntu',
    status: 'supported',
    line: 'Ubuntu 24.04 on x64. Taalcut uses your graphics card through CUDA or Vulkan when it can.',
    requirements: [
      ['System', 'Ubuntu 24.04'],
      ['Processor', 'x64'],
      ['Package', '.deb'],
      ['The agent on your computer', 'A graphics card with 8 GB of video memory'],
      ['Reels', 'Pasting a reel link isn’t there yet: drop the reel in as a file'],
    ],
  },
  {
    id: 'windows',
    name: 'Windows',
    status: 'coming-soon',
    line: 'Windows comes after 1.0. Join the waitlist and we’ll tell you when it’s ready.',
    requirements: [],
  },
];

/** What each platform will get, said where a status badge would sit: nothing has a download yet. */
export const PLATFORM_GETS: Readonly<Record<PlatformId, string>> = {
  macos: 'You get a .dmg for Apple silicon when the beta opens for macOS.',
  ubuntu: 'You get a .deb for x64 when the beta opens for Ubuntu.',
  windows: 'You get a Windows version after 1.0.',
};

/** The requirement stickers' glyphs, by name (the page maps each to its Lucide icon). */
export type PlatformGlyph = 'system' | 'chip' | 'memory' | 'space' | 'package' | 'gpu' | 'file';

/**
 * /download/ ("Platforms") in words: each platform shown as Taalcut running on it. The stickers on each window say in
 * a few words what the platform's requirements (PLATFORMS above, the page's facts) say in full.
 */
export const PLATFORMS_PAGE = {
  title: ['Made for your Mac.', 'Ubuntu too.'],
  lead: 'Taalcut is made for Macs with Apple silicon and runs on Ubuntu 24.04. Windows comes after 1.0. Nothing is out yet, so join the waitlist for yours.',
  jump: 'Go to a platform',
  platforms: {
    macos: {
      heading: 'Apple silicon Macs',
      join: 'Join for macOS',
      yours: 'You’re on a Mac',
      window: 'Remix a reel',
      stickers: [
        { glyph: 'system', words: 'macOS 14+' },
        { glyph: 'chip', words: 'M1 or later' },
        { glyph: 'memory', words: '8 GB memory' },
        { glyph: 'space', words: '20 GB free' },
      ],
    },
    ubuntu: {
      heading: 'Ubuntu 24.04',
      join: 'Join for Ubuntu',
      yours: 'You’re on Linux',
      window: 'Remix a reel',
      stickers: [
        { glyph: 'chip', words: 'x64' },
        { glyph: 'package', words: '.deb' },
        { glyph: 'gpu', words: '8 GB GPU for the agent' },
        { glyph: 'file', words: 'Reels go in as files' },
      ],
    },
    windows: {
      heading: 'Windows',
      join: 'Tell me when',
      yours: 'You’re on Windows',
      window: 'Taalcut for Windows',
      stickers: [],
      after: 'After 1.0',
    },
  } satisfies Readonly<
    Record<
      PlatformId,
      {
        readonly heading: string;
        readonly join: string;
        readonly yours: string;
        readonly window: string;
        readonly stickers: readonly { readonly glyph: PlatformGlyph; readonly words: string }[];
        readonly after?: string;
      }
    >
  >,
  /** Inside the app windows: the demo's own words. */
  app: {
    link: 'instagram.com/reel/…',
    beats: (n: number) => `${n} music beats`,
    slots: (n: number) => `${n} slots`,
    filled: (n: number) => `Filled ${n} slots from your camera roll.`,
    approve: 'Approve',
    aiPick: 'AI pick',
    sure: 'High',
    drop: 'Drop the reel in as a file',
    dropLine: 'On Ubuntu, pasting a reel link isn’t there yet.',
    file: 'vietnam-reel.mp4',
    roll: 'Camera roll',
    empty: 'Windows comes after 1.0',
    emptyLine: 'Join the waitlist and we’ll tell you when it’s ready.',
  },
} as const;
