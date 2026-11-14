// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Fact } from './schema';
import { LICENCE_LINE, SITE, TRADEMARK_POLICY } from './site';

/**
 * The About page (lane L6). Sources: NAMING.md (the name, the story, how to write and say it), design/logo/README.md
 * and kit/README.md (the Avartan), DESIGN.md › Kaatu, PRODUCT.md › Product Principles. Text may carry links as
 * `[label](href)`; the page renders them and the .md mirror keeps them.
 */

/** One beat group of jhaptaal, as the Avartan draws it (design/logo/README.md, concept A). */
export interface TaalGroup {
  /** The beats in the group, counted from 1 across the cycle. */
  readonly beats: readonly number[];
  /** The sign a tabla player writes over the group: X for sam, a number for a clap, 0 for the wave. */
  readonly sign: string;
  readonly name: string;
  readonly gesture: string;
  /** The arc's place in the logo, clockwise from the top: logo-1 (marigold) to logo-4 (teal). */
  readonly arc: 1 | 2 | 3 | 4;
  /** The arc's job colour, named, so the colour always has its word. */
  readonly colour: string;
}

export const JHAPTAAL: readonly TaalGroup[] = [
  { beats: [1, 2], sign: 'X', name: 'sam', gesture: 'the first beat, the heaviest arc', arc: 1, colour: 'marigold' },
  { beats: [3, 4, 5], sign: '2', name: 'tali', gesture: 'a clap, a medium arc', arc: 2, colour: 'rose' },
  { beats: [6, 7], sign: '0', name: 'khali', gesture: 'the wave, the lightest arc', arc: 3, colour: 'violet' },
  { beats: [8, 9, 10], sign: '3', name: 'tali', gesture: 'a clap, a medium arc', arc: 4, colour: 'teal' },
];

/** What Taalcut believes, each with the id its row's icon is chosen by. */
export interface Belief {
  readonly id: 'agent' | 'shows' | 'footage' | 'defaults' | 'yours';
  readonly belief: string;
  readonly why: string;
}

export const ABOUT = {
  definition:
    'Taalcut is a video editor for creators that makes your version of a reel you love, from your own camera roll. It’s named after taal, the rhythm cycle in Indian music.',
  /** The stickers beside the page's title: the name said, and what taal means. */
  stickers: { say: SITE.pronunciation, taal: 'Taal: the rhythm cycle', cut: 'Cut to the beat' },
  name: {
    heading: 'The name',
    lead: 'Two words, one rhythm. Taal keeps time, and cut is what an editor does.',
    facts: [
      ['Name', 'Taalcut, with one capital'],
      ['Say it', `${SITE.pronunciation}, the “aa” as in “father”`],
      ['Taal', 'The rhythm cycle in Indian music'],
      ['The story', SITE.story],
    ] satisfies readonly Fact[],
  },
  avartan: {
    heading: 'One cycle, four beats',
    lead: 'The logo is one avartan, a single turn of a rhythm cycle. It is drawn as jhaptaal: ten beats in groups of two, three, two and three.',
    body: [
      'Each arc’s weight follows its accent. Sam, the first beat, is the heaviest. The two claps are medium, and the wave is the lightest. The cycle is the taal; the gaps between the arcs are the cuts.',
      'The arcs carry the app’s four colours in the order of their jobs: marigold acts, rose keeps the beat, violet is the AI and teal is you.',
    ],
    replay: 'Count the cycle',
    counting: 'Counting',
    playhead: 'The playhead always comes back to sam, the first beat.',
  },
  kaatu: {
    heading: 'Kaatu',
    /** The sentence around the Hindi word, which the page marks lang="hi". */
    nameBefore: 'Kaatu is Taalcut’s mascot, a young beaver. The name comes from ',
    hindi: 'काटना',
    nameAfter: ', “to cut”: beavers cut, and Taalcut cuts your clips to the beat.',
    body: 'In the app Kaatu keeps you company at the foot of the sidebar. It thinks while work runs, looks pleased when it ends well and falls asleep after a quiet minute. It never sits on your footage.',
    /** What Kaatu does in the app, one row each. */
    moods: [
      ['Thinks', 'while an import, the agent or an export runs'],
      ['Cheers', 'when the work ends well'],
      ['Naps', 'after a quiet minute'],
    ] satisfies readonly Fact[],
    poke: 'Give it a poke.',
  },
  beliefs: {
    heading: 'What Taalcut believes',
    items: [
      { id: 'agent', belief: 'The agent does the work. You approve once.', why: 'Every step before that is there to see and change, but nothing waits on you.' },
      {
        id: 'shows',
        belief: 'Every AI decision shows, and can be undone.',
        why: 'What the AI decided is marked as its work, what you changed is marked as yours, and the timeline keeps the record.',
      },
      { id: 'footage', belief: 'Your footage comes first.', why: 'Your clips are the content. The app stays quiet around them, and they stay on your computer.' },
      { id: 'defaults', belief: 'No jargon, and defaults that work.', why: 'You shouldn’t need Settings to make your first video.' },
      {
        id: 'yours',
        belief: 'Your AI, your files.',
        why: 'The app doesn’t run AI for you or keep your files. Use the ChatGPT plan you have, your own keys or the models on your computer.',
      },
    ] satisfies readonly Belief[],
  },
  company: {
    heading: 'Who makes Taalcut',
    body: `[${SITE.company.legal}](${SITE.company.url}) makes Taalcut and runs this site.`,
  },
  code: {
    heading: 'The code is on GitHub',
    body: `${LICENCE_LINE} Read it, build it or open an issue at [github.com/satyajiit/taalcut](${SITE.repository}). The name and the logo follow ${TRADEMARK_POLICY}, so a fork takes a name of its own.`,
  },
  follow: {
    heading: 'Follow along',
    body: `News and works in progress are on Instagram at [${SITE.instagram.handle}](${SITE.instagram.url}).`,
  },
} as const;
