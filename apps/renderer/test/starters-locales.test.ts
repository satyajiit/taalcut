// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-L2's per-language half of the starters: each UI language is offered its eight (six for everyone, two of its
// own, as packages/templates ships them), and every one of them has a name in that language's catalogue.
import { describe, expect, it } from 'vitest';
import { STARTER_PLANS, startersFor } from '../src/backend/fake/phase3/starter-data';
import { starterName } from '../src/features/starters/starter-words';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { APP_LANGUAGES } from '../src/i18n/locales';

const EVERYONE = ['weekend-trip', 'my-day', 'quick-tip', 'product-in-30-seconds', 'glow-up', 'best-moments'];
const OWN: Record<(typeof APP_LANGUAGES)[number], readonly string[]> = {
  en: ['recipe-in-30-seconds', 'podcast-moment'],
  hi: ['festival-vlog', 'wedding-highlights'],
  es: ['receta-rapida', 'golazos'],
  'pt-BR': ['role-de-fim-de-semana', 'receita-rapida'],
};

describe('starters per language', () => {
  it('mirrors the shipped set: fourteen starters', () => {
    expect(STARTER_PLANS.map((plan) => plan.id).sort()).toEqual(
      [...EVERYONE, ...Object.values(OWN).flat()].sort(),
    );
  });

  for (const locale of APP_LANGUAGES) {
    it(`${locale}: its eight starters, each named in its own catalogue`, async () => {
      const offered = startersFor({ clips: 40 }, { locale, forLibrary: false });
      expect(offered.map((starter) => starter.starterId)).toEqual([...EVERYONE, ...OWN[locale]]);
      await activateLocale(locale);
      for (const starter of offered) {
        expect(starter.nameKey in i18n.messages, `${starter.nameKey} in ${locale}`).toBe(true);
        expect(starterName(i18n, starter.nameKey)).not.toBe('');
      }
    });
  }

  it('puts the best fit for the library first', () => {
    const first = (clips: number) => startersFor({ clips }, { locale: 'hi', forLibrary: true })[0]?.starterId;
    expect(first(1)).toBe('quick-tip');
    expect(first(2)).toBe('glow-up');
    expect(first(30)).toBe('weekend-trip');
  });
});
