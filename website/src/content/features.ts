// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { MORE_FEATURES, MORE_STEPS, MORE_STICKERS } from './features-more';
import type { Feature } from './schema';

/**
 * The feature pages, in the order the index lists them: the five parts of making a video like a reel you saved, then
 * the rest of what Taalcut does (features-more.ts). Every fact is in the truth ledger.
 */
const REEL_FEATURES: readonly Feature[] = [
  {
    slug: 'reel-breakdown',
    group: 'reel',
    name: 'Read any reel',
    definition:
      'Taalcut reads a reel you paste or drop in and writes down its cuts, music beats, on-screen text, transitions and pacing, so it can be made again with your clips.',
    summary:
      'Paste a link or drop a file. Taalcut finds the cuts and music beats, and you can fix what it got wrong before it’s used.',
    facts: [
      ['Takes', 'Reels, Shorts and TikTok links, or a video file (on Ubuntu, a file for now)'],
      ['Finds', 'Cuts, music beats, on-screen text and its timing, transitions, speed ramps, pacing'],
      ['You can', 'Fix a cut, halve or double the tempo, or say whether something is text'],
      ['The music', 'Kept on your Mac and used by default; you can switch it off'],
    ],
    status: 'shipped',
  },
  {
    slug: 'auto-pick',
    group: 'reel',
    name: 'Your camera roll, sorted',
    definition:
      'Taalcut indexes your clips on your Mac and fills each slot of a template with the clip that fits, says how sure it is, and keeps up to three other shots to swap in.',
    summary:
      'No more scrolling through a thousand clips. Each slot says what it needs, and Taalcut finds it in your footage.',
    facts: [
      ['From', 'Your phone over Wi-Fi with a QR code and PIN, or folders read in place'],
      ['On your Mac', 'Shots, what’s in them, on-screen text and speech, indexed on the device'],
      ['Search', 'In plain words (“the dance shots”), by trip, place or activity'],
      [
        'Picks',
        'One clip per slot in story order, how sure it is, up to three other shots, up to 10 versions',
      ],
    ],
    status: 'shipped',
  },
  {
    slug: 'templates',
    group: 'reel',
    name: 'Reels become templates',
    definition:
      'A reel’s breakdown becomes a template you can fill again with new footage, as often as you like.',
    summary:
      'The reel you saved last month is a template you keep. Fill it with this weekend’s trip, then next month’s.',
    facts: [
      ['A template keeps', 'The slots, the music beats, the text and its timing'],
      ['Starters', '8 starter templates in your language, 14 in all'],
      ['Reuse', 'Fill one template with any footage, as many times as you want'],
    ],
    status: 'shipped',
  },
  {
    slug: 'agent',
    group: 'reel',
    name: 'The editor you talk to',
    definition:
      'Taalcut’s agent makes the video for you, checks the cut against the reel before you see it, and asks you to approve once.',
    summary:
      'Say what you want in a sentence. The agent cuts, checks its own work against the reel, and shows you the result.',
    facts: [
      ['You do', 'Paste a reel, point at your footage, approve'],
      ['It checks', 'Every cut against the reel before you see it'],
      ['Undo', 'Every edit, the agent’s included'],
      ['How hard it thinks', 'Chosen from the chat box, one setting'],
    ],
    status: 'shipped',
  },
  {
    slug: 'editor',
    group: 'reel',
    name: 'Fine-tune when you want',
    definition:
      'A timeline editor for the moments you want to change something yourself: trims, captions, music beats, graphics and exports.',
    summary:
      'The agent’s work is on the timeline, marked as its own. Swap, move or slip a clip, and it is marked as yours.',
    facts: [
      ['Timeline', 'Split, trim, speed ramps, transitions, colour, fades'],
      ['Captions', 'Word by word, and as an SRT file'],
      ['Graphics', 'Designed by the AI for your video, with values you can edit'],
      ['Export', 'MP4 (H.264 or HEVC) for Reels, Shorts and TikTok, 4K masters; OTIO and FCPXML for other editors'],
    ],
    status: 'shipped',
  },
];

export const FEATURES: readonly Feature[] = [...REEL_FEATURES, ...MORE_FEATURES];

/** The index's two groups, in order: their headings and one line each. */
export const FEATURE_GROUPS: readonly { readonly id: Feature['group']; readonly title: string; readonly lead: string }[] = [
  {
    id: 'reel',
    title: 'Make it like the reel you saved',
    lead: 'Five parts of one pass, from the reel you saved to the video you post, each running on a reel from a trip to Vietnam.',
  },
  {
    id: 'more',
    title: 'More ways to make',
    lead: 'Footage from wherever it is, shorts from long videos, sounds trending in Edits, videos for what you build, and plugins.',
  },
];

/**
 * How each feature works, in two or three short steps: the feature page's "How it works", in the page's HTML for
 * search and AI engines. Every sentence is in the truth ledger's "Say" column. (The shape lives here until the
 * foundation takes `FeatureStep` into schema.ts; WEB1-SHOW hand-off.)
 */
export interface FeatureStep {
  readonly title: string;
  readonly body: string;
}

export const FEATURE_STEPS: Readonly<Record<string, readonly FeatureStep[]>> = {
  ...MORE_STEPS,
  'reel-breakdown': [
    {
      title: 'Paste a link or drop a file',
      body: 'Reels, Shorts and TikTok links work, and so does a video file; on Ubuntu, drop the reel in as a file for now. Taalcut keeps a copy of the reel and its music on your computer.',
    },
    {
      title: 'It writes the reel down',
      body: 'Taalcut finds the cuts and music beats, the text on screen and when it shows, the transitions, the speed ramps and the pacing.',
    },
    {
      title: 'You fix what it isn’t sure of',
      body: 'A cut Taalcut isn’t sure of is flagged in words. Move it to the right frame or say it looks right. You can also halve or double the tempo, or say whether something is text. The template keeps your fixes.',
    },
  ],
  'auto-pick': [
    {
      title: 'Bring your clips',
      body: 'Scan a QR code with your phone and type the PIN: clips come over your Wi-Fi, with nothing to install on the phone. Folders on your Mac are read where they are.',
    },
    {
      title: 'Taalcut indexes them on your Mac',
      body: 'It notes the shots, what’s in them, the text on screen and what’s said. Search in plain words, by trip, place or activity.',
    },
    {
      title: 'Each slot gets a clip',
      body: 'One clip per slot, in story order. Each slot says what it wants and how sure Taalcut is of its pick, with up to three other shots to swap in. Or ask for up to 10 versions.',
    },
  ],
  templates: [
    {
      title: 'A reel becomes its slots',
      body: 'The breakdown keeps the reel’s slots, its music beats, and its text and timing, as a template in your library.',
    },
    {
      title: 'Fill it again, as often as you like',
      body: 'Point the template at new footage and Taalcut fills every slot again. This weekend’s trip, then next month’s.',
    },
    {
      title: 'Or begin with a starter',
      body: 'For the days you have no reel to copy, starters come built in, in eight formats from a vlog to a podcast clip. Each fills from your clips like any template.',
    },
  ],
  agent: [
    {
      title: 'Say what you want',
      body: 'Paste a reel, point at your footage, and say it in a sentence. You choose how hard it thinks from the chat box, one setting for every chat.',
    },
    {
      title: 'It checks its own work',
      body: 'Before you see anything, the agent checks the cut against the reel: cuts on the beat, and each shot showing what its moment needs.',
    },
    {
      title: 'You approve once',
      body: 'You see the finished video and approve it once. Every edit can be undone, the agent’s included.',
    },
  ],
  editor: [
    {
      title: 'The AI’s work is marked',
      body: 'Every clip the AI picked carries a violet edge. Swap, move or slip one and it turns teal, marked as yours. A trim only moves its edge, on the beat.',
    },
    {
      title: 'Captions word by word',
      body: 'Captions follow the words as they are said, and export as an SRT file too.',
    },
    {
      title: 'Graphics with values you can edit',
      body: 'The AI designs graphics for your video. Change their values, and export MP4 for Reels, Shorts and TikTok, or OTIO and FCPXML for other editors.',
    },
  ],
};

/**
 * Each feature's key facts as the header's stickers: a few words each, in the order they sit. Every one is in the
 * truth ledger; the feature's own facts and steps say it in full.
 */
export const FEATURE_STICKERS: Readonly<Record<string, readonly string[]>> = {
  ...MORE_STICKERS,
  'reel-breakdown': ['Reels, Shorts and TikTok', 'Cuts and music beats', 'You fix what it isn’t sure of'],
  'auto-pick': ['From your phone over Wi-Fi', 'Search in plain words', 'Says how sure it is'],
  templates: ['Fill it again and again', 'Keeps the music beats', 'Each slot says what it needs'],
  agent: ['Checks the cut against the reel', 'You approve once', 'Undo every edit'],
  editor: ['Trims land on the beat', 'Captions as an SRT file', 'MP4, OTIO and FCPXML'],
};

/** The features index: its h1, and its answer-first line (every feature in one sentence, each working below). */
export const FEATURES_INDEX = {
  title: 'What Taalcut does',
  lead: 'It reads a reel you saved, sorts your camera roll, keeps the reel as a template, makes the video with you in a chat, and leaves the timeline open for you to change. It also brings in footage from anywhere, cuts shorts from long videos, finds the sounds trending in Edits, and makes videos for what you build.',
  stickers: ['Eleven features, one app', 'For Reels, Shorts and TikTok', 'On footage from real trips'],
} as const;

/** The feature after this one, in the index's order; the last leads back to the first. */
export function nextFeature(slug: string): Feature {
  const at = FEATURES.findIndex((f) => f.slug === slug);
  return FEATURES[(at + 1) % FEATURES.length] ?? (FEATURES[0] as Feature);
}

export function feature(slug: string): Feature {
  const found = FEATURES.find((f) => f.slug === slug);
  if (!found) throw new Error(`No feature ${slug}`);
  return found;
}
