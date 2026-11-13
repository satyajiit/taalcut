// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The shipped starters (P3-B3, P3-L2). `starters:build` turns each row into a hub file. */
import type { AppLocale, FormatId, StarterNeed } from '@taalcut/core';

export interface StarterSpec {
  readonly id: string;
  readonly formatId: FormatId;
  readonly seconds: number;
  /** Null uses the format default (120). */
  readonly bpm: number | null;
  readonly locales: 'all' | readonly [AppLocale, ...AppLocale[]];
  readonly needs: StarterNeed;
}

export type StarterLocales = 'all' | readonly AppLocale[];

export const STARTER_CATALOGUE = [
  { id: 'weekend-trip', formatId: 'vlog', seconds: 30, bpm: null, locales: 'all', needs: 'many-clips' },
  { id: 'my-day', formatId: 'dayInTheLife', seconds: 30, bpm: null, locales: 'all', needs: 'day-clips' },
  { id: 'quick-tip', formatId: 'talkingHead', seconds: 30, bpm: 100, locales: 'all', needs: 'talking' },
  { id: 'product-in-30-seconds', formatId: 'ugcAd', seconds: 30, bpm: 120, locales: 'all', needs: 'product' },
  { id: 'glow-up', formatId: 'beforeAfter', seconds: 15, bpm: 120, locales: 'all', needs: 'two-clips' },
  {
    id: 'best-moments',
    formatId: 'highlightReel',
    seconds: 15,
    bpm: 128,
    locales: 'all',
    needs: 'many-clips',
  },
  {
    id: 'recipe-in-30-seconds',
    formatId: 'tutorial',
    seconds: 30,
    bpm: 100,
    locales: ['en'],
    needs: 'steps',
  },
  {
    id: 'podcast-moment',
    formatId: 'podcastClip',
    seconds: 30,
    bpm: 100,
    locales: ['en'],
    needs: 'conversation',
  },
  { id: 'festival-vlog', formatId: 'vlog', seconds: 45, bpm: 110, locales: ['hi'], needs: 'many-clips' },
  {
    id: 'wedding-highlights',
    formatId: 'highlightReel',
    seconds: 30,
    bpm: 128,
    locales: ['hi'],
    needs: 'many-clips',
  },
  {
    id: 'receta-rapida',
    formatId: 'tutorial',
    seconds: 30,
    bpm: 100,
    locales: ['es'],
    needs: 'steps',
  },
  { id: 'golazos', formatId: 'highlightReel', seconds: 15, bpm: 140, locales: ['es'], needs: 'many-clips' },
  {
    id: 'role-de-fim-de-semana',
    formatId: 'vlog',
    seconds: 30,
    bpm: null,
    locales: ['pt-BR'],
    needs: 'many-clips',
  },
  { id: 'receita-rapida', formatId: 'tutorial', seconds: 30, bpm: 100, locales: ['pt-BR'], needs: 'steps' },
] as const satisfies readonly StarterSpec[];

export type StarterCatalogueId = (typeof STARTER_CATALOGUE)[number]['id'];

/** Provenance locale: the starter's language, or English when it is shown everywhere. */
export function starterProvenanceLocale(locales: StarterLocales): AppLocale {
  if (locales === 'all') return 'en';
  return locales[0] ?? 'en';
}

/** Hub card language: null when every locale sees the starter. */
export function starterCardLanguage(locales: StarterLocales): AppLocale | null {
  if (locales === 'all') return null;
  return locales[0] ?? null;
}
