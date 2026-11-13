// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { YOUR_AI_SECTION } from './home';
import { API_KEYS, CHATGPT, ON_DEVICE, OWN_SERVER, PROVIDER_GRID, PROVIDERS } from './providers';
import type { Provider, ProviderWay } from './schema';

/* content: the AI stories' words · mode: Persuade · system: WEB2 Remix Vernacular · states: none · motion: none */

/**
 * AI1 lane S: every AI Taalcut works with, told as a story (/ai/'s providers, the home's Your AI, the ChatGPT window's
 * moments). No fact is typed here. Every story's words are sliced, word for word, from the modules that hold them:
 * - a provider's own line: PROVIDERS[].does (providers.ts);
 * - the keys: API_KEYS.lead, sentence by sentence, and API_KEYS.cap (providers.ts: "A US$2 budget per project");
 * - your own server: OWN_SERVER.lead's second sentence (providers.ts);
 * - Taalcut's own models: YOUR_AI_SECTION.device.line, sentence by sentence (home.ts), and ON_DEVICE.lead (providers.ts);
 * - ChatGPT: its does line, CHATGPT.facts[0] (where you sign in) and CHATGPT.lead's second sentence (providers.ts).
 * What this file adds are labels only: a segment's short name, the tray's headers (themselves PROVIDER_GRID's and
 * CHATGPT's words) and the controls' names. test/unit/ai-stories.test.ts holds every story's words to its source.
 */

/** A text's sentences, each with its full stop: how a lead becomes one fact a segment, word for word. */
export function sentencesOf(text: string): readonly string[] {
  return (text.match(/[^.]+\.(?=\s|$)/g) ?? [text]).map((s) => s.trim());
}

/** The ring round a story's avatar: violet for a cloud AI (the AI), teal for your computer (yours), ink for your server. */
export type StoryRing = 'ai' | 'you' | 'server';

export interface StorySegment {
  /** The segment's short name, beside the author as a story's time sits (new label). */
  readonly label: string;
  /** One fact, in its source's words. */
  readonly words: string;
  /** A second line under it, also in its source's words. */
  readonly more?: string;
}

export interface AiStory {
  readonly id: string;
  readonly provider: Provider;
  readonly ring: StoryRing;
  /** The camera roll clip whose frame plays dimmed behind the words (the owner's footage, #content/reels). */
  readonly clip: string;
  readonly segments: readonly StorySegment[];
}

const [KEY_PASTE = '', KEY_KEPT = ''] = sentencesOf(API_KEYS.lead);
const [, SERVER_NEVER = ''] = sentencesOf(OWN_SERVER.lead);
const [DEVICE_ALWAYS = '', DEVICE_CAN = ''] = sentencesOf(YOUR_AI_SECTION.device.line);
const [, NO_SECOND_BILL = ''] = sentencesOf(CHATGPT.lead);
const SIGN_IN_WHERE = CHATGPT.facts[0]?.[1] ?? '';

/** The way each provider comes in, as a ring. */
export const RING_OF: Readonly<Record<ProviderWay, StoryRing>> = { subscription: 'ai', 'api-key': 'ai', 'own-server': 'server', 'on-device': 'you' };

/** The tray's headers, one a way (PROVIDER_GRID's three, and CHATGPT's own step name for the plan). */
export const WAY_HEADERS: Readonly<Record<ProviderWay, string>> = {
  subscription: CHATGPT.steps[2].label,
  'api-key': PROVIDER_GRID.ways['api-key'].label,
  'own-server': PROVIDER_GRID.ways['own-server'].label,
  'on-device': PROVIDER_GRID.ways['on-device'].label,
};

/** The ways in the tray's order, which is PROVIDERS' order. */
export const STORY_WAYS: readonly ProviderWay[] = ['subscription', 'api-key', 'own-server', 'on-device'];

/** A segment's short names (new labels). */
const LABEL = {
  does: 'What it does',
  key: 'Your key',
  keychain: 'Your keychain',
  budget: 'Budget',
  plan: CHATGPT.steps[2].label,
  signIn: CHATGPT.steps[1].label,
  bill: 'One bill',
  optional: 'Optional',
  always: ON_DEVICE.facts[0]?.[0] ?? '',
  can: 'Can run here',
  install: 'Nothing to install',
} as const;

function segmentsFor(p: Provider): StorySegment[] {
  switch (p.way) {
    case 'subscription':
      return [
        { label: LABEL.plan, words: p.does },
        { label: LABEL.signIn, words: SIGN_IN_WHERE },
        { label: LABEL.bill, words: NO_SECOND_BILL },
      ];
    case 'api-key':
      return [
        { label: LABEL.does, words: p.does },
        { label: LABEL.key, words: KEY_PASTE },
        { label: LABEL.keychain, words: KEY_KEPT },
        { label: LABEL.budget, words: API_KEYS.cap[0], more: API_KEYS.cap[1] },
      ];
    case 'own-server':
      return [
        { label: LABEL.does, words: p.does },
        { label: LABEL.optional, words: SERVER_NEVER },
      ];
    case 'on-device':
      return [
        { label: LABEL.always, words: DEVICE_ALWAYS },
        { label: LABEL.can, words: DEVICE_CAN },
        { label: LABEL.install, words: ON_DEVICE.lead },
      ];
  }
}

/**
 * Which of the owner's roll clips sits behind each story: a different shot each, none repeated, day views and city
 * nights in turn, and never one with words of its own on screen (the airport reel burns in its captions, and the
 * Vietnam reel's opening shot its chat bubbles), which would talk over a story's words.
 */
const CLIPS: Readonly<Record<string, string>> = {
  chatgpt: 'repeat-08',
  openai: 'vietnam-04',
  anthropic: 'repeat-10',
  google: 'vietnam-09',
  openrouter: 'vietnam-03',
  elevenlabs: 'vietnam-06',
  'on-device': 'repeat-09',
  ollama: 'vietnam-13',
  'lm-studio': 'vietnam-12',
};

/** Every AI as a story, in the tray's order (PROVIDERS' order). */
export const AI_STORIES: readonly AiStory[] = PROVIDERS.map((p) => ({
  id: p.id,
  provider: p,
  ring: RING_OF[p.way],
  clip: CLIPS[p.id] ?? 'repeat-01',
  segments: segmentsFor(p),
}));

export function storyById(id: string): AiStory {
  return AI_STORIES.find((s) => s.id === id) ?? (AI_STORIES[0] as AiStory);
}

/** The controls' names and the stories' small words (new labels). */
export const STORIES = {
  /** The tray, for assistive technology: PROVIDER_GRID's heading. */
  tray: PROVIDER_GRID.heading,
  storyOf: (name: string) => `${name}’s story`,
  previous: 'Previous',
  next: 'Next',
  replay: 'Play the story again',
  /** The one-line status a step says. */
  status: (at: number, of: number, label: string) => `${at} of ${of}: ${label}`,
  /** The ChatGPT story's link sticker: the window's own button words, up to its demo. */
  chatgptLink: CHATGPT.row.button,
  /** Local only on, over the cloud AIs (home.ts). */
  paused: YOUR_AI_SECTION.local.paused,
} as const;

/**
 * /ai/ · Continue with ChatGPT: the window's three steps, each carrying its facts (indexes into CHATGPT.facts). A step's
 * big words are its own line (CHATGPT.steps[].line), or, where a fact says the same thing in fewer words, that fact
 * (`lead`): the sign-in's line and "Where you sign in" are one fact, so step 2 says it once. The two stickers on the
 * window say CHATGPT.facts[0] and the lead's second sentence shorter, both in full on the page (step 2's big words, and
 * the section's lead).
 */
export const CHATGPT_MOMENTS: readonly {
  readonly step: (typeof CHATGPT.steps)[number]['id'];
  readonly lead?: 0 | 1 | 2 | 3;
  readonly facts: readonly (0 | 1 | 2 | 3)[];
}[] = [
  { step: 'accounts', facts: [1] },
  { step: 'sign-in', lead: 0, facts: [] },
  { step: 'plan', facts: [2, 3] },
];

export const CHATGPT_STICKERS = {
  /** From step 2 on: CHATGPT.facts[0]'s second sentence, without its full stop. */
  password: 'Taalcut never sees your password',
  /** At step 3: CHATGPT.lead's "There is no second bill from Taalcut." */
  bill: 'No second bill from Taalcut',
  /** The step bar, for assistive technology. */
  steps: 'The sign-in, step by step',
  /** The window's own words under its heading (the app's Accounts page). */
  accountsLine: 'Sign in to the AI you use, or add a key.',
  replay: 'Play the sign-in again',
  stepOf: (at: number, label: string) => `Step ${at} of 3: ${label}`,
} as const;
