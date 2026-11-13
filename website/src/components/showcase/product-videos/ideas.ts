// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The product in the showcase: Taalcut itself, with taalcut.app as its source. Each video idea is about one of
 * Taalcut's features and is backed by lines taken, word for word, from that feature's page on this site
 * (#content/features), so every quote a visitor reads is real. The words around them are the app's
 * (apps/renderer/src/features/products, read, never imported: products-page.tsx, product-content.tsx,
 * product-schedule.tsx, product-fields.tsx, product-publishing*.tsx), with "draft" said as "video" on the site.
 */

import { feature } from '#content/features';

export const PRODUCT = {
  name: 'Taalcut',
  /** The product's mode on the Products page (the app's "Drafts prepared for you"). */
  mode: 'Videos prepared for you',
} as const;

export type ProductSourceKind = 'website' | 'folder' | 'social';

export const PRODUCT_SOURCES: readonly { readonly id: string; readonly kind: ProductSourceKind; readonly label: string; readonly name: string }[] = [
  { id: 'site', kind: 'website', label: 'Website', name: 'taalcut.app' },
  { id: 'folder', kind: 'folder', label: 'Your project folder', name: 'website' },
  { id: 'social', kind: 'social', label: 'Social page', name: '@taalcut.app' },
];

/** A line from a source, and where it was found. */
export interface Evidence {
  readonly locator: string;
  readonly excerpt: string;
}

export interface Idea {
  readonly id: string;
  /** The feature it is about: one feature an idea. */
  readonly slug: string;
  readonly hook: string;
  readonly rationale: string;
  /** Why this idea fits: the angle, then the lines behind it. */
  readonly angle: string;
  readonly evidence: readonly Evidence[];
  /** The idea's sticker: a clause of one of those lines, word for word, short enough to sit on its reel card. */
  readonly quote: string;
  /** The owner's clip its video opens on. */
  readonly clipId: string;
  readonly seconds: number;
}

/** A feature's page on the site, as research records where a line came from. */
export function locatorOf(slug: string): string {
  return `taalcut.app/features/${slug}/`;
}

/** The feature page's own lines: its definition, and the values of the facts named. */
function linesFrom(slug: string, facts: readonly string[]): Evidence[] {
  const f = feature(slug);
  const values = facts.map((label) => f.facts.find(([l]) => l === label)?.[1] ?? '');
  return [f.definition, ...values].filter(Boolean).map((excerpt) => ({ locator: locatorOf(slug), excerpt }));
}

/** The name of the feature an idea is about, as the site names it. */
export function featureName(idea: Idea): string {
  return feature(idea.slug).name;
}

const IDEAS: Readonly<Record<string, Omit<Idea, 'id' | 'evidence'> & { readonly facts: readonly string[] }>> = {
  breakdown: {
    slug: 'reel-breakdown',
    hook: 'Paste a reel. Get its cuts and music beats back.',
    rationale: 'A before and after anyone can follow: a reel goes in, its cuts and beats come out.',
    angle: 'Open on a saved reel, then show its slots and music beats filling in, and one cut fixed by hand.',
    clipId: 'repeat-05',
    seconds: 24,
    quote: 'Cuts, music beats, on-screen text and its timing',
    facts: ['Finds'],
  },
  shorts: {
    slug: 'shorts',
    hook: 'One long video in. A short that ends where the story does.',
    rationale: 'Long videos are where a lot of footage sits, and this turns one into something to post.',
    angle: 'Start on a long video’s timeline, then cut to the short with its captions on.',
    clipId: 'airport-01',
    seconds: 30,
    quote: 'Whole sentences and scenes: a hook, the context and the payoff',
    facts: ['It picks'],
  },
  roll: {
    slug: 'auto-pick',
    hook: 'Stop scrolling for the shot.',
    rationale: 'Searching in plain words reads well on screen, and every viewer has a camera roll like this one.',
    angle: 'Type “the night shots” and let the camera roll answer, then a pick lands in its slot.',
    clipId: 'vietnam-10',
    seconds: 20,
    quote: 'In plain words (“the dance shots”), by trip, place or activity',
    facts: ['Search'],
  },
  edits: {
    slug: 'instagram-edits',
    hook: 'Cut your next video to a sound trending in Edits.',
    rationale: 'It ties Taalcut to the sounds people are already cutting to.',
    angle: 'Show the trending sounds, the hook marked in seconds, then the cuts landing on it.',
    clipId: 'repeat-15',
    seconds: 24,
    quote: 'Where each sound’s hook drops, in seconds',
    facts: ['Hooks'],
  },
  import: {
    slug: 'import',
    hook: 'Scan a code. Your phone’s clips are in.',
    rationale: 'The phone is where the footage starts, so the video starts there too.',
    angle: 'A phone scans the code, footage arrives on the computer, and each copy is checked.',
    clipId: 'repeat-04',
    seconds: 20,
    quote: 'scan a code and choose footage in the phone’s browser, with nothing to install',
    facts: ['From your phone'],
  },
  templates: {
    slug: 'templates',
    hook: 'Last month’s reel, this weekend’s trip.',
    rationale: 'It shows the one idea behind Taalcut: a reel you keep and fill again.',
    angle: 'One template, filled twice: the night clips, then the day clips, on the same beats.',
    clipId: 'airport-09',
    seconds: 30,
    quote: 'The slots, the music beats, the text and its timing',
    facts: ['A template keeps'],
  },
};

function idea(id: keyof typeof IDEAS): Idea {
  const { facts, ...rest } = IDEAS[id]!;
  return { id, ...rest, evidence: linesFrom(rest.slug, facts) };
}

/** Two rounds of research: the second finds other features, since no topic comes back before its days are up. */
export const BATCHES: readonly (readonly Idea[])[] = [
  [idea('breakdown'), idea('shorts'), idea('roll')],
  [idea('edits'), idea('import'), idea('templates')],
];

export function batchOf(round: number): readonly Idea[] {
  return BATCHES[((round % BATCHES.length) + BATCHES.length) % BATCHES.length]!;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* The schedule (product-schedule.tsx) and the product's video settings (product-fields.tsx)                        */
/* ---------------------------------------------------------------------------------------------------------------- */

/** The week as the app lists it, Monday first; `day` is JavaScript's (0 is Sunday). */
export const WEEK: readonly { readonly day: number; readonly short: string; readonly name: string }[] = [
  { day: 1, short: 'Mon', name: 'Monday' },
  { day: 2, short: 'Tue', name: 'Tuesday' },
  { day: 3, short: 'Wed', name: 'Wednesday' },
  { day: 4, short: 'Thu', name: 'Thursday' },
  { day: 5, short: 'Fri', name: 'Friday' },
  { day: 6, short: 'Sat', name: 'Saturday' },
  { day: 0, short: 'Sun', name: 'Sunday' },
];

export const SCHEDULE = {
  days: [1, 3, 5] as readonly number[],
  time: '09:00',
  timezone: 'Asia/Kolkata',
  noveltyDays: 14,
  perDay: 1,
  budget: '5.00',
} as const;

/** Toggle a research day, never leaving none (the app keeps at least one). */
export function toggleDay(days: readonly number[], day: number): readonly number[] {
  if (days.includes(day)) return days.length > 1 ? days.filter((d) => d !== day) : days;
  return WEEK.map((w) => w.day).filter((d) => d === day || days.includes(d));
}

/** The next chosen day after `today` (0–6), by name: research at the set time on that day. */
export function nextResearchDay(days: readonly number[], today: number): string {
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const day = (today + ahead) % 7;
    if (days.includes(day)) return WEEK.find((w) => w.day === day)!.name;
  }
  return WEEK[0]!.name;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* The video made from an idea, and its post (product-publishing.tsx, product-publishing-copy.tsx)                  */
/* ---------------------------------------------------------------------------------------------------------------- */

export type PostStatus = 'waiting' | 'queued' | 'scheduled';

export const POST_STATUS: Readonly<Record<PostStatus, string>> = {
  waiting: 'Awaiting approval',
  queued: 'Approved · queued',
  scheduled: 'Scheduled',
};

export const POST = {
  platform: 'Instagram Reels',
  account: '@taalcut.app',
  when: 'Tuesday, 18:30',
  timezone: 'Asia/Kolkata',
  master: '2160 × 3840 · 60 fps',
} as const;

/** The exported master's file name. */
export function fileOf(idea: Idea): string {
  return `taalcut-${idea.slug}.mp4`;
}

/** The post's words: the idea's hook, what it is, and where to go. */
export function captionOf(idea: Idea): string {
  return `${idea.hook} ${featureName(idea)}, in Taalcut. Join the waitlist at taalcut.app.`;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* The arrival: research finds ideas, the first one's lines open, its video is made and its post waits              */
/* ---------------------------------------------------------------------------------------------------------------- */

export const PRODUCT_PASS = {
  ideas: [1100, 1260, 1420],
  open: 1750,
  making: 2150,
  ready: 2850,
  post: 3150,
  end: 3150,
} as const;

/** How long a visitor's own research or video takes, in ms. */
export const RESEARCH_MS = 1100;
export const MAKING_MS = 900;
export const QUEUED_MS = 900;

export interface ProductFrame {
  readonly researching: boolean;
  /** How many ideas have arrived. */
  readonly ideas: number;
  readonly open: boolean;
  readonly video: 'none' | 'making' | 'ready';
  readonly post: boolean;
}

export function productPassAt(at: number): ProductFrame {
  return {
    researching: at >= 0 && at < PRODUCT_PASS.ideas[0],
    ideas: PRODUCT_PASS.ideas.filter((t) => at >= t).length,
    open: at >= PRODUCT_PASS.open,
    video: at >= PRODUCT_PASS.ready ? 'ready' : at >= PRODUCT_PASS.making ? 'making' : 'none',
    post: at >= PRODUCT_PASS.post,
  };
}

export function productPassTimes(): number[] {
  return [0, ...PRODUCT_PASS.ideas, PRODUCT_PASS.open, PRODUCT_PASS.making, PRODUCT_PASS.ready, PRODUCT_PASS.post];
}
