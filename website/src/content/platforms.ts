// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { RELEASE } from './release';
import type { Platform, PlatformId } from './schema';

/**
 * Platforms. The release (content/release.ts) is a .dmg for Apple silicon Macs and nothing else: `released` marks
 * the platform with a download, `not-yet` the ones without, and neither says when. Ubuntu is 24.04 only where the site
 * names a version: 22.04 has never been run. The 8 GB and 20 GB are recommendations.
 */
export const PLATFORMS: readonly Platform[] = [
  {
    id: 'macos',
    name: 'macOS',
    status: 'released',
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
    status: 'not-yet',
    line: 'Built from source, Taalcut runs on Ubuntu 24.04 on x64 and uses your graphics card through CUDA or Vulkan when it can.',
    requirements: [
      ['System', 'Ubuntu 24.04'],
      ['Processor', 'x64'],
      ['The agent on your computer', 'A graphics card with 8 GB of video memory'],
      ['Reels', 'Pasting a reel link isn’t there yet: drop the reel in as a file'],
    ],
  },
  {
    id: 'windows',
    name: 'Windows',
    status: 'not-yet',
    line: 'Windows comes after 1.0.',
    requirements: [],
  },
];

/** What each platform has today, said where a status badge would sit: one download, for the Mac. */
export const PLATFORM_GETS: Readonly<Record<PlatformId, string>> = {
  macos: `You get ${RELEASE.name} as a .dmg, signed with a Developer ID and notarized by Apple.`,
  ubuntu: 'No Ubuntu download yet, and no date for one.',
  windows: 'No Windows download yet.',
};

/** The requirement stickers' glyphs, by name (the page maps each to its Lucide icon). */
export type PlatformGlyph = 'system' | 'chip' | 'memory' | 'space' | 'gpu' | 'file';

/**
 * /download/ in words: the download for a Mac, then each platform shown as Taalcut running on it. The stickers on
 * each window say in a few words what the platform's requirements (PLATFORMS above, the page's facts) say in full.
 */
export const PLATFORMS_PAGE = {
  title: ['Taalcut for your Mac.', 'Free to download.'],
  lead: `${RELEASE.name} is out for Macs with Apple silicon on ${RELEASE.system}. Ubuntu and Windows have no download yet.`,
  jump: 'Go to a platform',
  /** The links under the Mac's facts and Ubuntu's: the release's page, and the repository. */
  notes: 'Release notes and checksums',
  source: 'Source on GitHub',
  platforms: {
    macos: {
      heading: 'Apple silicon Macs',
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
      yours: 'You’re on Linux',
      window: 'Remix a reel',
      stickers: [
        { glyph: 'chip', words: 'x64' },
        { glyph: 'gpu', words: '8 GB GPU for the agent' },
        { glyph: 'file', words: 'Reels go in as files' },
      ],
      after: 'No download yet',
    },
    windows: {
      heading: 'Windows',
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
    emptyLine: 'There is no Windows version to download yet.',
  },
} as const;
