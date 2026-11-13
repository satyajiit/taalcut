// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- hub authors' names, handles, tags and slot intents: data, never translated */

/**
 * The fake hub's 40 templates (P3-B12, P3-V8) as their authors wrote them: name, handle, language, tags, format,
 * tempo and how many people rated them. hub-seed.ts turns each into a hub template v0 file and its index row.
 * Number 1 is the results card's "Morning café" (packages/ui fixtures-hub.ts). Number 39 has since been hidden
 * by a maintainer (its file answers hub.hidden); number 40 is written in a newer file format.
 */
import type { FormatId } from '@taalcut/core';

export interface HubSeed {
  readonly n: number;
  readonly name: string;
  readonly handle: string;
  readonly language: string | null;
  readonly tags: readonly string[];
  readonly formatId: FormatId | null;
  readonly bpm: number | null;
  /** Beats per slot (or seconds × 2 without a tempo). */
  readonly slots: readonly number[];
  /** [count, mean]; null: nobody has rated it. */
  readonly rating: readonly [number, number] | null;
  /** Days since the trend was fresh; null: not a trend. */
  readonly trendDays: number | null;
  /** Days since it was last updated. */
  readonly age: number;
  readonly description: string;
}

type Row = [
  name: string,
  handle: string,
  language: string | null,
  tags: string,
  formatId: FormatId | null,
  bpm: number | null,
  slots: string,
  rating: readonly [number, number] | null,
  trendDays: number | null,
  age: number,
  description: string,
];

// prettier-ignore
const ROWS: readonly Row[] = [
  ['Morning café', 'mira.cuts', 'en', 'cafe,morning,vlog', 'vlog', 104, '2,2,2,3,2,2,2,2', [38, 4.6], 14, 2, 'Slow coffee, quick cuts: eight shots that land on the beat.'],
  ['Street food crawl', 'ana_edita', 'pt-BR', 'food,street,travel', 'highlightReel', 120, '1,1,2,1,1,2,1,1,2,2', [112, 4.8], 6, 1, 'Cinco barracas, dez cortes, uma fome enorme.'],
  ['Golden hour walk', 'dev.frames', 'en', 'sunset,travel,calm', 'vlog', 92, '4,4,4,4,4', [57, 4.4], 30, 9, 'Long, calm shots for the last light of the day.'],
  ['Gym day split', 'liftwithraj', 'hi', 'fitness,gym', 'dayInTheLife', 128, '2,2,2,2,2,2,2,2,2,2,2,2', [24, 4.1], null, 12, 'Warm-up se cool-down tak, har set beat par.'],
  ['Three-step fix', 'kim.tutorials', 'en', 'tutorial,howto', 'tutorial', null, '6,8,8,8,4', [19, 4.3], null, 20, 'Problem, three steps, result. Text boxes tell the steps.'],
  ['Before and after room', 'casa.nova', 'es', 'home,makeover,before-after', 'beforeAfter', 110, '4,1,4', [76, 4.7], 3, 4, 'El antes, un corte seco y el después.'],
  ['Podcast hot take', 'mic.drop', 'en', 'podcast,talking', 'podcastClip', null, '6,10,10,6', [9, 3.9], null, 30, 'Hook line first, then the take, captions all the way.'],
  ['Unboxing in 15', 'tech.tiny', 'en', 'unboxing,product,tech', 'ugcAd', 120, '2,2,2,2,2,2,2,2,2,2', [44, 4.2], 9, 5, 'Box, reveal, three details, the price, call to action.'],
  ['Monsoon diaries', 'chai.and.rain', 'hi', 'rain,monsoon,mood', 'vlog', 84, '4,4,2,2,4,4', [2, 4.5], 20, 3, 'बारिश, चाय और खिड़की। धीमे कट।'],
  ['Day in my life: nurse', 'ward.rounds', 'en', 'work,day-in-the-life', 'dayInTheLife', 116, '2,2,2,2,2,2,2,2,2,2,2,2,2,2', [131, 4.5], null, 15, 'Alarm to night shift handover in fourteen shots.'],
  ['Recipe in 30 seconds', 'pan.y.sal', 'es', 'food,recipe,cooking', 'tutorial', 100, '2,2,2,2,2,2,2,2,2,2,2,2,4', [63, 4.6], 11, 6, 'Ingredientes, pasos rápidos y el plato final.'],
  ['Skate park lines', 'kickflip.kai', 'en', 'skate,sport,action', 'highlightReel', 140, '2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2', [18, 4], 40, 25, 'Sixteen tricks, one per bar, hardest last.'],
  ['Mercado de sábado', 'feira.livre', 'pt-BR', 'market,food,weekend', 'vlog', 96, '4,2,2,2,2,4,4', [1, 4], 5, 2, 'Cores, vozes e sacolas cheias.'],
  ['Outfit of the week', 'fit.check', 'en', 'fashion,outfit,style', 'highlightReel', 124, '1,1,1,1,1,1,1,2,2,2', [88, 4.4], 2, 1, 'Seven looks on the beat, then the favourite slowed down.'],
  ['Desk setup tour', 'build.station', 'en', 'tech,setup,desk', 'ugcAd', 108, '4,2,2,2,2,2,4', [27, 4.2], null, 40, 'Wide reveal, details, the one thing that changed everything.'],
  ['Wedding first look', 'veil.and.vow', 'en', 'wedding,love,family', 'highlightReel', 72, '4,4,4,8', [52, 4.9], null, 18, 'Four long shots and a held moment.'],
  ['Trek to the lake', 'trail.tara', 'hi', 'trek,mountains,travel', 'vlog', 100, '2,2,2,4,2,2,2,4', [14, 4.3], 25, 8, 'Base camp, the climb, the view.'],
  ['Product in hand', 'ugc.ines', 'es', 'product,ugc,ad', 'ugcAd', 118, '2,2,2,2,2,2', [6, 3.8], 12, 7, 'Problema, producto, prueba y oferta.'],
  ['Late night study', 'quiet.desk', 'en', 'study,lofi,calm', 'dayInTheLife', 80, '4,4,4,4,4,4', [33, 4.5], null, 50, 'Lamp on, pages turn, the window gets dark.'],
  ['Puppy first day', 'paws.patrol', 'en', 'pets,dog,cute', 'highlightReel', 112, '2,2,1,1,2,2,2,4', [97, 4.8], 1, 1, 'Every first: the bowl, the stairs, the nap.'],
  ['Mumbai local rush', 'platform.nine', 'hi', 'city,train,rush', 'vlog', 132, '1,1,1,1,1,1,1,1,2,2,2', [0, 0], 4, 1, 'Ek station, gyarah cut, poora rush.'],
  ['Talking head with b-roll', 'say.it.short', 'en', 'talking,explainer', 'talkingHead', null, '6,4,6,4,6,4', [21, 4], null, 60, 'Speak to camera, cut away on every point.'],
  ['Praia ao amanhecer', 'mar.calmo', 'pt-BR', 'beach,sunrise,calm', 'vlog', 76, '4,4,4,4', null, null, 70, 'Quatro planos longos antes de o sol subir.'],
  ['Bakery behind the scenes', 'flour.hour', 'en', 'bakery,food,work', 'dayInTheLife', 104, '2,2,2,2,2,2,2,2,2,2', [45, 4.6], 8, 10, 'Four a.m. to the first customer.'],
  ['Hook test: 3 openers', 'growth.notes', 'en', 'hooks,marketing', 'talkingHead', null, '3,3,3,10', [12, 3.6], null, 22, 'Three hooks to camera; keep the one that holds.'],
  ['Concert night', 'front.row', 'es', 'music,concert,night', 'highlightReel', 150, '1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,2', [39, 4.3], 7, 3, 'Luces, gente y el estribillo en cámara lenta.'],
  ['Garden glow-up', 'green.thumb', 'en', 'garden,before-after,home', 'beforeAfter', 96, '4,2,4', [2, 4.5], null, 33, 'Weeds, one wipe, flowers.'],
  ['Tea ceremony', 'slow.steep', 'en', 'tea,calm,ritual', 'vlog', 70, '4,4,4,4,4,4', [16, 4.7], null, 90, 'Six shots, no rush.'],
  ['Road trip day one', 'van.and.map', 'en', 'roadtrip,travel,van', 'vlog', 112, '2,2,2,2,4,2,2,2,4', [70, 4.4], 18, 13, 'Packing, the first stop, the first sunset.'],
  ['Cricket nets', 'cover.drive', 'hi', 'cricket,sport', 'highlightReel', 120, '2,2,2,2,2,2,2,2', [8, 4.1], null, 45, 'Har shot ek beat par, aakhri six slow-mo mein.'],
  ['Clase de baile', 'paso.a.paso', 'es', 'dance,tutorial', 'tutorial', 122, '2,2,2,2,2,2,2,2,2,2,2,2', [29, 4.5], 3, 2, 'Ocho tiempos, cuatro pasos, todo junto al final.'],
  ['Thrift haul', 'second.round', 'en', 'fashion,thrift,haul', 'highlightReel', 118, '1,1,1,1,1,1,2,2,2,2', [61, 4.3], 10, 6, 'Bag dump, six finds, the one you have to see.'],
  ['City at night', 'neon.walks', 'en', 'city,night,walk', 'vlog', 98, '4,2,2,4,2,2,4', [3, 4.2], 16, 4, 'Signs, steam, reflections.'],
  ['Morning routine', 'sunrise.sana', 'hi', 'morning,routine,self-care', 'dayInTheLife', 100, '2,2,2,2,2,2,2,2,2', [104, 4.6], 5, 2, 'Alarm, paani, yoga, nashta.'],
  ['Podcast duo clip', 'two.mics', 'en', 'podcast,talking,duo', 'podcastClip', null, '4,6,6,6,4', [11, 4], null, 28, 'Question, answer, reaction, captions on both voices.'],
  ['Restaurante secreto', 'come.bien', 'es', 'food,restaurant', 'vlog', 108, '2,2,2,2,2,4,4', [22, 4.4], 21, 14, 'La puerta, la cocina, el primer bocado.'],
  ['Phone photography tips', 'snap.smart', 'en', 'photography,tutorial,phone', 'tutorial', null, '6,6,6,6,6', [47, 4.5], null, 35, 'Five tips, one shot each, the result after every tip.'],
  ['Studio flip', 'small.space', 'en', 'home,makeover,before-after', 'beforeAfter', 104, '6,1,6', [34, 4.6], 13, 9, 'Twenty square metres, one weekend.'],
  ['Viral dance trend', 'trend.tracker', 'en', 'dance,trend', 'highlightReel', 128, '1,1,1,1,1,1,1,1,2,2', null, 1, 0, 'The move everyone is doing this week.'],
  ['Cooking with grandma', 'nani.kitchen', 'hi', 'food,family,recipe', 'tutorial', 90, '4,4,4,4,4,4', [5, 4.8], null, 19, 'Nani ke haath, ek recipe, chhe shot.'],
];

const list = (text: string) => text.split(',').filter(Boolean);

export const HUB_SEEDS: readonly HubSeed[] = ROWS.map(
  ([name, handle, language, tags, formatId, bpm, slots, rating, trendDays, age, description], index) => ({
    n: index + 1,
    name,
    handle,
    language,
    tags: list(tags),
    formatId,
    bpm,
    slots: list(slots).map(Number),
    rating: rating && rating[0] > 0 ? rating : null,
    trendDays,
    age,
    description,
  }),
);

/** Hidden by a maintainer after the index was built: the file answers hub.hidden. */
export const HIDDEN_SEED = 39;
/** Written in hub file format 1, which this build can't read: hub.unsupported_format. */
export const FUTURE_FORMAT_SEED = 40;

/** What each slot asks for, by shot type: the authors' own words. */
export const INTENTS: Readonly<Record<string, readonly string[]>> = {
  wide: [
    'Wide shot to set the place',
    'Wide establishing shot, slow push in',
    'The whole scene from across the room',
  ],
  medium: [
    'Medium shot of you doing the thing',
    'Waist-up, looking at the camera',
    'Medium shot, walking into frame',
  ],
  close: ['Close-up of hands at work', 'Close-up of the face reacting', 'Tight on the cup as it is poured'],
  detail: ['Detail of the texture', 'Macro of the label', 'One small detail that tells the story'],
  pov: ['Your point of view walking in', 'POV over the counter', 'Looking down at your feet as you go'],
  text: ['Text card with the hook', 'Text card with the price', 'End card with the call to action'],
};
