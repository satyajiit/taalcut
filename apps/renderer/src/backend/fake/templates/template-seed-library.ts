// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- template names, tags, folder names and on-screen text: data, never translated */

/**
 * The template library at scale (P3-V14): `templates: 200` in `taalcut.fake` gives a library of that size, the
 * same on every run, built from varied plans (4–13 slots, four tempos and speech-led ones, four languages) with
 * tags, folders, favourites, trend dates (some older than 90 days), provenance (hub forks, files, starters) and
 * use counts. Contact sheets share a few drawings, so the media fake paints each once.
 */
import type { FormatId, Id, Template, TemplateSummary } from '@taalcut/core';
import { fakeUlid, pick, prng, sceneHash } from '../library/seed';
import { buildTemplate, TEMPLATE_KIND, TEMPLATE_T0, type TemplatePlan } from './template-data';
import type { SlotPlan } from './template-plans';

export type LibraryMeta = Pick<
  TemplateSummary,
  'tags' | 'folderId' | 'favourite' | 'trendFreshness' | 'provenance' | 'archived' | 'listed'
>;

export interface SeedTemplate {
  readonly template: Template;
  readonly name: string;
  readonly meta: Partial<LibraryMeta>;
  readonly used: number;
  readonly updatedAt: number;
}

export interface SeedFolder {
  readonly id: Id<'TemplateFolder'>;
  readonly name: string;
  readonly createdAt: number;
}

const DAY = 86_400_000;
const folderId = (n: number) => fakeUlid<'TemplateFolder'>(TEMPLATE_KIND.folder, n);
export const hubTemplateId = (n: number) => fakeUlid<'HubTemplate'>(TEMPLATE_KIND.hub, n);
const isoDay = (at: number) => new Date(at).toISOString().slice(0, 10);

const FOLDER_NAMES = ['Travel', 'Client work', 'Weddings', 'Food', 'Rough cuts', 'Festive'] as const;

/** The folders: two beside the three templates, six beside a big library. */
export function seedFolders(large: boolean): SeedFolder[] {
  return FOLDER_NAMES.slice(0, large ? 6 : 2).map((name, i) => ({
    id: folderId(i + 1),
    name,
    createdAt: TEMPLATE_T0 - (40 - i) * DAY,
  }));
}

/** What the three hand-made templates (template-plans.ts, by plan number) carry in the library. */
export const BASE_META: Readonly<Record<number, { meta: Partial<LibraryMeta>; used: number }>> = {
  1: {
    meta: {
      tags: ['travel', 'golden-hour'],
      folderId: folderId(1),
      favourite: true,
      trendFreshness: { date: '2026-09-28', source: 'reference' },
    },
    used: 4,
  },
  2: {
    meta: { tags: ['morning', 'routine'], trendFreshness: { date: '2026-05-02', source: 'reference' } },
    used: 1,
  },
  3: { meta: { tags: ['hooks'] }, used: 0 },
};

const TOPICS = [
  'Sunday market',
  'Rooftop dinner',
  'Monsoon walk',
  'Gym progress',
  'Coffee run',
  'Street food crawl',
  'Weekend hike',
  'Studio tour',
  'Unboxing',
  'Book haul',
  'Night drive',
  'Beach day',
  'Wedding entry',
  'Mehendi night',
  'Product drop',
  'Recipe',
  'Room makeover',
  'Skincare routine',
  'Train journey',
  'Festival lights',
  'Dog walk',
  'First apartment',
  'Desk setup',
  'Bike ride',
  'Picnic',
  'Concert night',
  'Road trip',
  'Bakery visit',
  'Garden update',
  'Outfit check',
  'Cafe hopping',
  'Sunrise run',
  'Lake weekend',
  'Pottery class',
  'Airport day',
  'Rainy day in',
  'Thrift haul',
  'Birthday surprise',
  'Market haul',
  'Late night ramen',
] as const;
const SHAPES = ['', ' recap', ' teaser', ' in 15 seconds', ' story'] as const;

const NATIVE: Readonly<Record<'hi' | 'es' | 'pt-BR', readonly string[]>> = {
  hi: [
    'शादी की झलक',
    'दिवाली की रौनक',
    'मुंबई की बारिश',
    'चाय पर चर्चा',
    'घर का खाना',
    'होली के रंग',
    'सुबह की सैर',
    'बाज़ार की सैर',
    'पहाड़ों में एक दिन',
    'माँ के हाथ का खाना',
    'गोवा ट्रिप',
    'संगीत की रात',
  ],
  es: [
    'Fin de semana en la playa',
    'Receta rápida',
    'Mercado de domingo',
    'Ruta en bici',
    'Café de la esquina',
    'Boda en el jardín',
    'Noche de tapas',
    'Mi rutina de mañana',
    'Viaje a la montaña',
    'Feria del pueblo',
    'Tarde de lluvia',
    'Paseo por el centro',
  ],
  'pt-BR': [
    'Dia de praia',
    'Rotina da manhã',
    'Feira de domingo',
    'Receita em 30 segundos',
    'Trilha no fim de semana',
    'Café da tarde',
    'Festa junina',
    'Passeio de bicicleta',
    'Noite de show',
    'Casamento no campo',
    'Viagem de carro',
    'Pôr do sol na praia',
  ],
};
const WORDS: Readonly<Record<string, { title: string; cta: string }>> = {
  en: { title: 'Wait for it', cta: 'Follow for more' },
  hi: { title: 'अंत तक देखो', cta: 'और देखने के लिए फ़ॉलो करें' },
  es: { title: 'Espera al final', cta: 'Sígueme para más' },
  'pt-BR': { title: 'Espera o final', cta: 'Me segue pra mais' },
};
const TAGS = [
  'travel',
  'food',
  'fitness',
  'wedding',
  'festival',
  'beach',
  'city',
  'morning',
  'product',
  'recipe',
  'music',
  'family',
  'night',
  'fast-cuts',
  'talking',
] as const;
const NATIVE_TAGS: Readonly<Record<string, string>> = { hi: 'शादी', es: 'viaje', 'pt-BR': 'receita' };
const INTENTS = [
  'Close-up of hands at work',
  'Wide shot of the place, people moving through',
  'A face reacting, handheld',
  'Detail of food being served',
  'Walking shot from behind',
  'The view from a window',
  'A quick pan across the room',
  'Someone laughing at the camera',
  'Feet on the move, low angle',
  'The sign or the name of the place',
] as const;
const SHOTS: readonly SlotPlan['shotType'][] = ['wide', 'medium', 'close', 'detail', 'pov', null];
const MOTIONS: readonly SlotPlan['motion'][] = ['static', 'pan', 'handheld', 'tilt', null];
/** Tempo and frames per beat at 30 fps; null is speech-led, slots in seconds. */
const TEMPOS = [
  [120, 15],
  [100, 18],
  [90, 20],
  [150, 12],
  [null, 30],
] as const;
const SPEECH_FORMATS: readonly FormatId[] = ['vlog', 'dayInTheLife', 'talkingHead', 'tutorial', 'ugcAd'];
const HANDLES = ['maya.cuts', 'reelsbyraj', 'lucia.edits', 'tiago_films'] as const;
const STARTERS = ['weekend-trip', 'my-day', 'best-moments', 'quick-tip'] as const;

function slotsFor(random: () => number, speech: boolean): SlotPlan[] {
  const count = 4 + Math.floor(random() * 10);
  const peak = 1 + Math.floor(random() * (count - 2));
  return Array.from({ length: count }, (_, i) => ({
    beats: speech ? 2 + Math.floor(random() * 5) : 1 + Math.floor(random() * 4),
    role: i === 0 ? 'hook' : i === count - 1 ? 'outro' : i === peak ? 'peak' : 'body',
    text: pick(random, INTENTS),
    shotType: pick(random, SHOTS),
    motion: pick(random, MOTIONS),
    energy: Math.round((0.25 + random() * 0.7) * 100) / 100,
  }));
}

/** The k-th generated name: native ones for the first few of each language, then topic and shape pairs. */
function nameFor(k: number, language: string): string {
  const native = language === 'en' ? undefined : NATIVE[language as keyof typeof NATIVE];
  if (native) return native[Math.floor(k / 5) % native.length]!;
  const pair = (k * 37) % (TOPICS.length * SHAPES.length);
  return `${TOPICS[pair % TOPICS.length]}${SHAPES[Math.floor(pair / TOPICS.length)]}`;
}

function languageFor(k: number): string {
  // One in five is Hindi, Spanish or Portuguese, in turn; the rest English.
  if (k % 5 !== 2) return 'en';
  return (['hi', 'es', 'pt-BR'] as const)[Math.floor(k / 5) % 3]!;
}

/** `count − 3` templates beside the three hand-made ones, numbered from 100. */
export function seedLibrary(count: number): SeedTemplate[] {
  const folders = seedFolders(true);
  const names = new Set<string>();
  return Array.from({ length: Math.max(0, count - 3) }, (_, k) => {
    const n = 100 + k;
    const random = prng(n * 7_331);
    const [bpm, beatFrames] = TEMPOS[Math.floor(random() * TEMPOS.length)]!;
    const language = languageFor(k);
    // A starter's fork is named by the starter's id, as template.addStarter names it; the page shows its name.
    const starter = k % 25 === 11 ? STARTERS[k % STARTERS.length]! : null;
    let name = starter ?? nameFor(k, language);
    if (!starter && names.has(name)) name = `${name} ${Math.floor(k / 5) + 2}`;
    names.add(name);
    const slots = slotsFor(random, bpm === null);
    const words = WORDS[language]!;
    const plan: TemplatePlan = {
      n,
      name,
      platform: pick(random, ['reels', 'tiktok', 'shorts'] as const),
      bpm,
      beatFrames,
      scene: Math.floor(random() * 7),
      language,
      slots,
      overlays: [
        { slot: 0, text: words.title, role: 'title' as const },
        ...(random() < 0.5 ? [{ slot: slots.length - 1, text: words.cta, role: 'cta' as const }] : []),
      ],
    };
    const built = buildTemplate(plan);
    const createdAt = TEMPLATE_T0 - Math.floor((2 + random() * 300) * DAY) - k * 1000;
    const sheet = built.contactSheet;
    const template: Template = {
      ...built,
      createdAt,
      origin:
        built.origin.kind === 'format'
          ? { ...built.origin, formatId: pick(random, SPEECH_FORMATS) }
          : built.origin.kind === 'reference'
            ? { ...built.origin, analysedAt: createdAt }
            : built.origin,
      // A few drawings, shared: each (scene, grid) is painted once however many templates use it.
      contactSheet: sheet && {
        ...sheet,
        asset: sceneHash(plan.scene, 7_000 + sheet.columns * 10 + sheet.rows, 9),
      },
    };
    const meta: Partial<LibraryMeta> = {};
    const tags = TAGS.filter(() => random() < 0.12).slice(0, 3);
    const native = NATIVE_TAGS[language];
    meta.tags = native && random() < 0.6 ? [native, ...tags.slice(0, 2)] : tags;
    if (random() < 0.6) meta.folderId = pick(random, folders).id;
    if (random() < 0.12) meta.favourite = true;
    if (built.origin.kind === 'reference' || random() < 0.15) {
      const daysBack = 3 + Math.floor(random() * 220);
      meta.trendFreshness = {
        date: isoDay(TEMPLATE_T0 - daysBack * DAY),
        source: built.origin.kind === 'reference' ? 'reference' : 'user',
      };
    }
    if (k % 10 === 3) {
      const removed = k % 70 === 13;
      meta.provenance = {
        kind: 'hub',
        hubId: hubTemplateId(n),
        version: 1 + (k % 3),
        handle: HANDLES[k % HANDLES.length]!,
        licence: 'CC0-1.0',
        forkedAt: createdAt,
        removed,
      };
      if (meta.trendFreshness) meta.trendFreshness = { ...meta.trendFreshness, source: 'hub' };
    } else if (k % 20 === 7) meta.provenance = { kind: 'file', importedAt: createdAt, hubId: null };
    else if (starter) meta.provenance = { kind: 'starter', starterId: starter, locale: 'en' };
    if (k % 50 === 21) meta.archived = true;
    const used = random() < 0.3 ? 0 : Math.floor(random() * 12);
    const updatedAt = createdAt + Math.floor(random() * (TEMPLATE_T0 + 2 * DAY - createdAt));
    return { template, name, meta, used, updatedAt };
  });
}
