// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CAMERA_ROLL } from '#content/reels';

/**
 * The auto-pick page's camera roll: the owner's own clips (#content/reels, the camera roll's atlas): the shots of the
 * Vietnam and airport reels, and the raw phone clips "Vietnam, on repeat" was cut from. Each has the few plain words
 * Taalcut's index would hold for it, written by a person looking at its frames (public/media/roll/atlas.webp), so a
 * search in plain words can find it.
 */

export interface RollClip {
  /** The camera roll's clip id (#content/reels), which places its frames in the atlas. */
  readonly id: string;
  /** What the shot shows, as the index says it. */
  readonly name: string;
  /** The same in two words, for a tight place (a grid tile, a timeline block). */
  readonly short: string;
  /** ISO date: the grid groups by day. */
  readonly day: string;
  readonly seconds: number;
  /** Its frame in the atlas. */
  readonly sprite: number;
  /** Plain words the index holds for it. */
  readonly tags: readonly string[];
}

/** Per clip: what its frames show, the same in two words, and the plain words the index holds for it. */
const WORDS: Readonly<Record<string, readonly [name: string, short: string, tags: string]>> = {
  'vietnam-01': ['Airport walkway, back to the camera', 'Airport walkway', 'airport walk suitcase day indoor'],
  'vietnam-02': ['Red lanterns on a night street', 'Red lanterns', 'lanterns red street night crowd lights'],
  'vietnam-03': ['Temple flags in green trees', 'Temple flags', 'temple flags trees green day'],
  'vietnam-04': ['A neon heart and an orange car', 'Neon heart', 'neon heart car night lights'],
  'vietnam-05': ['Palm trees on a resort deck', 'Resort deck', 'palm trees resort deck day'],
  'vietnam-06': ['A jungle path', 'Jungle path', 'jungle path trees green day walk'],
  'vietnam-07': ['Coloured lights over a night street', 'Night lights', 'lights street night colour'],
  'vietnam-08': ['Rain and neon in the city', 'Rain and neon', 'rain neon city night lights'],
  'vietnam-09': ['A temple front by day', 'Temple front', 'temple day'],
  'vietnam-10': ['A narrow neon street', 'Neon street', 'neon street night narrow'],
  'vietnam-11': ['A city street with towers ahead', 'City towers', 'city street towers day'],
  'vietnam-12': ['Arches under a starry ceiling', 'Starry arches', 'arches ceiling stars indoor'],
  'vietnam-13': ['Lanterns overhead at dusk', 'Dusk lanterns', 'lanterns dusk night lights'],
  'airport-01': ['A check-in hall, walking in', 'Check-in hall', 'airport terminal walk backpack day indoor'],
  'airport-02': ['Gate signs over the trolleys', 'Gate signs', 'airport gate sign trolleys indoor'],
  'airport-03': ['Travellers under the gates sign', 'To the gates', 'airport gate travellers walk day indoor'],
  'airport-04': ['A wide hall with a baggage belt', 'Baggage hall', 'airport hall baggage lights indoor'],
  'airport-05': ['A Dreamliner on the apron', 'Plane on apron', 'plane airport apron stairs day'],
  'airport-06': ['The queue at the aircraft door', 'Boarding', 'plane boarding queue door'],
  'airport-07': ['The engine and runway from the window', 'Window seat', 'plane window engine runway wing day'],
  'airport-08': ['Climbing over the city in haze', 'Climb out', 'plane window city haze engine day'],
  'airport-09': ['City lights at night under the wing', 'City lights', 'plane window city night lights wing'],
  'repeat-01': ['Limestone cliffs over a garden path', 'Garden cliffs', 'cliffs limestone karst garden path trees green day'],
  'repeat-02': ['Islands across open water in Hạ Long Bay', 'Hạ Long Bay', 'bay sea water islands karst halong day'],
  'repeat-03': ['Karst peaks over a green field', 'Karst field', 'karst peaks field green wires sky day'],
  'repeat-04': ['Four coffees with tree art in the foam', 'Coffee art', 'coffee cups art hands table cafe day'],
  'repeat-05': ['A boat crossing the bay under the cliffs', 'Boat in the bay', 'boat bay sea water cliffs karst day'],
  'repeat-06': ['Paper lanterns in yellow, white, blue and green', 'Paper lanterns', 'lanterns paper colour lights overhead'],
  'repeat-07': ['Small boats on a river under green peaks', 'River boats', 'river boats water green karst peaks day'],
  'repeat-08': ['Palm trees above a beach on a clear day', 'Beach palms', 'beach palm trees sea sky day'],
  'repeat-09': ['An old stone gate over a pond of lily pads', 'Stone gate', 'gate stone temple pond lily water day'],
  'repeat-10': ['On the pier by the ferry, back to the camera', 'Ferry pier', 'pier ferry boat water sea day'],
  'repeat-11': ['Green water under the karst peaks in Ninh Bình', 'Ninh Bình', 'river water green karst peaks ninh binh day'],
  'repeat-12': ['City traffic under blue road signs', 'City traffic', 'city traffic cars road signs street day'],
  'repeat-13': ['A train down Hà Nội’s train street at night', 'Train street', 'train street night crowd lights hanoi'],
  'repeat-14': ['A lone karst hill over tall grass', 'Karst hill', 'karst hill grass green sky day'],
  'repeat-15': ['A pool at sunset, palms and huts on the deck', 'Sunset pool', 'pool sunset palm trees deck water evening'],
};

/** Every clip of the camera roll that has its words, in the roll's order (test/unit/showcase-auto-pick.test.ts). */
export const SAMPLE_ROLL: readonly RollClip[] = CAMERA_ROLL.clips.flatMap((c) => {
  const words = WORDS[c.id];
  if (!words) return [];
  const [name, short, tags] = words;
  return [{ id: c.id, name, short, day: c.day, seconds: c.durationSec, sprite: c.sprite, tags: tags.split(' ') }];
});

/** The words the search field offers to try. */
export const SEARCH_SUGGESTIONS = ['night', 'plane', 'street'] as const;

/** Small words a person types that say nothing about a shot ("the dance shots"). */
const FILLER = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'my', 'with', 'and', 'from', 'shot', 'shots', 'clip', 'clips', 'video', 'videos', 'some', 'all']);

function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

/** The meaningful words of a search, lowercased and without plurals. */
export function searchWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0 && !FILLER.has(word))
    .map(stem);
}

/** The clips a search in plain words finds: every meaningful word starts one of the clip's words or tags. */
export function matchClips(clips: readonly RollClip[], query: string): RollClip[] {
  const words = searchWords(query);
  if (words.length === 0) return [...clips];
  return clips.filter((item) => {
    const own = [...item.tags, ...searchWords(item.name)].map(stem);
    return words.every((word) => own.some((tag) => tag.startsWith(word)));
  });
}

/** The roll grouped by day, oldest first, keeping each day's order. */
export function byDay(clips: readonly RollClip[]): { readonly day: string; readonly clips: readonly RollClip[] }[] {
  const days = new Map<string, RollClip[]>();
  for (const item of clips) days.set(item.day, [...(days.get(item.day) ?? []), item]);
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day, clips: list }));
}

/** "Saturday, Oct 4": the day in words, as the app's day heading says it (UTC, so the server and browser agree). */
export function dayWords(day: string): string {
  return new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/** A clip's length as the app's chips say it: "6.5 s", "0.6 s". */
export function clipLength(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} s`;
}

export function clipById(id: string): RollClip {
  const found = SAMPLE_ROLL.find((item) => item.id === id);
  if (!found) throw new Error(`No clip ${id} in the roll`);
  return found;
}
