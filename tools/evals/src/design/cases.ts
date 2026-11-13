// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The design eval's cases (HFW1 dsn): 24 requests the Editor hands the Designer on one made-up video (a lake
 * day: a text from Maya, a race in three days, a trail to the pier). Eighteen ask for a new graphic; six change one
 * already there (a chat bubble, a headline, a lower third, placed from the fixtures before the case starts): to
 * match a reference frame, "make it pop more", two comments, words too small, and a move off a face. Every word
 * is made up. Each case names words its graphic must carry.
 */

/** A graphic placed before the case starts, from a fixture design (src/fixtures/design/). */
export interface PlacedBefore {
  readonly fixture: 'bubble.html' | 'headline.html' | 'lower-third.html';
  readonly name: string;
  readonly at: number;
  readonly params: Readonly<Record<string, string>>;
}

export interface DesignCase {
  readonly id: string;
  /** The person's words, as the Editor hands them over. */
  readonly request: string;
  readonly at?: number;
  readonly phrase?: string;
  /** A redesign: the graphic it changes. */
  readonly before?: PlacedBefore;
  /** The redesign comes as a comment on the graphic: the Designer must answer it. */
  readonly comment?: boolean;
  /** A reference picture to match: a fixture design drawn over grey, given as an image artifact. */
  readonly reference?: 'reference-bubbles.html';
  /** Words the graphic must carry (in its values or its defaults), any case. */
  readonly words: readonly string[];
}

export const DESIGN_VIDEO = {
  clips: [4, 4, 4],
  captions: [
    [0.5, 3.0, 'So we finally made it to the lake'],
    [3.2, 6.0, 'Maya texted me this morning asking if we were still on'],
    [6.4, 9.0, 'Three days until the big race'],
    [9.2, 11.8, 'Follow the trail from the car park to the pier'],
  ],
} as const;

const bubble: PlacedBefore = {
  fixture: 'bubble.html',
  name: 'Chat bubble',
  at: 3.4,
  params: { message: 'Are we still on for the lake?' },
};
const headline: PlacedBefore = { fixture: 'headline.html', name: 'Headline', at: 0.5, params: { title: 'Lake day' } };
const lowerThird: PlacedBefore = {
  fixture: 'lower-third.html',
  name: 'Name title',
  at: 1,
  params: { name: 'Sam Rivera', role: 'Trail runner' },
};

export const DESIGN_CASES: readonly DesignCase[] = [
  { id: 'newspaper-headline', request: 'a newspaper-style headline: LOCAL CREW REACHES THE LAKE', at: 0.5, words: ['lake'] },
  { id: 'chat-bubble', request: "a chat bubble with Maya's text: are we still on for the lake?", phrase: 'Maya texted me', words: ['still on'] },
  { id: 'chat-reply', request: 'my reply as a chat bubble on the right: yes, leaving now', at: 5, words: ['leaving now'] },
  { id: 'map-pin-route', request: 'a map pin at the pier with a route line that draws itself from the car park', phrase: 'Follow the trail', words: ['pier'] },
  { id: 'countdown', request: 'a countdown that ticks to 3 days to go until the race', phrase: 'Three days until', words: ['3'] },
  { id: 'lower-third-brand', request: 'a lower third with my name, Sam Rivera, Trail Runner, in my brand colours: deep green #1f5f4a and sand #e9dcc0', at: 1, words: ['Sam Rivera'] },
  { id: 'title-card', request: 'a big title that says LAKE DAY over the first shot', at: 0, words: ['lake day'] },
  { id: 'location-tag', request: 'a small location tag: Lake Merrow, 9:12 am', at: 0.8, words: ['Merrow'] },
  { id: 'pull-quote', request: "pull out 'we finally made it' as a big quote", phrase: 'we finally made it', words: ['finally made it'] },
  { id: 'checklist', request: 'a checklist of shoes, water and sunscreen, ticking each one off', at: 6.5, words: ['water'] },
  { id: 'progress-bar', request: 'a progress bar that fills to 3 of 5 km', at: 9.5, words: ['km'] },
  { id: 'friday-sticker', request: 'a sticker that says new video every Friday', at: 10.5, words: ['Friday'] },
  { id: 'date-stamp', request: 'a date stamp, 12 June, in the top corner', at: 0.2, words: ['June'] },
  { id: 'stars-burst', request: 'three little stars that pop up around Maya’s message', phrase: 'Maya texted me', words: [] },
  { id: 'arrow-callout', request: 'an arrow pointing at the pier with the word HERE', at: 9.4, words: ['here'] },
  { id: 'big-number', request: 'a big number: 1,240 m climbed', at: 7, words: ['1,240'] },
  { id: 'day-card', request: "a card that says 'Day 3 of 5' with 'The lake loop' under it", at: 3.3, words: ['Day 3'] },
  { id: 'weather-chip', request: 'a weather chip: 18° and sunny', at: 1.5, words: ['sunny'] },
  { id: 'match-reference', request: 'make the chat bubbles look like the ones in this frame', before: bubble, reference: 'reference-bubbles.html', words: ['still on'] },
  { id: 'pop-more', request: 'make it pop more', before: headline, words: ['lake day'] },
  { id: 'comment-rounder', request: 'rounder corners and a softer shadow on this bubble', before: bubble, comment: true, words: ['still on'] },
  { id: 'comment-brand', request: 'use my brand green #1f5f4a here', before: lowerThird, comment: true, words: ['Sam Rivera'] },
  { id: 'words-too-small', request: 'the words are too small to read on a phone', before: lowerThird, words: ['Sam Rivera'] },
  { id: 'move-off-face', request: 'move it up a little, it covers my face', before: headline, words: ['lake day'] },
];

/** The cases a run asks for, by id (all when none). */
export function designCases(ids: readonly string[] = []): DesignCase[] {
  if (ids.length === 0) return [...DESIGN_CASES];
  const unknown = ids.filter((id) => !DESIGN_CASES.some((entry) => entry.id === id));
  if (unknown.length > 0) throw new Error(`No design case ${unknown.join(', ')}`);
  return DESIGN_CASES.filter((entry) => ids.includes(entry.id));
}
