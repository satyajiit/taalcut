// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { I18nProvider } from '@lingui/react';
import { CARD_TYPES, type Card } from '@taalcut/core';
import { CARD_COMPONENTS, CARD_FIXTURES, CardActionsProvider, CardView } from '@taalcut/ui';
import { render } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activateLocale, i18n } from '../src/i18n/i18n';

/**
 * P1-H4 "Done when": every card type renders from its fixtures in light and
 * dark and in the pseudo-locale. jsdom has no CSS, so the theme check is that
 * the markup is the same in both themes (cards never read the theme in
 * JavaScript, DESIGN.md rule 3); the look in each theme is in the Playwright
 * screenshots of the seeded conversation.
 */

const fixtures = Object.entries(CARD_FIXTURES).flatMap(([type, set]) =>
  Object.entries(set).map(([name, card]) => ({ label: `${type}/${name}`, card: card as Card })),
);

const actions = {
  runFix: () => undefined,
  decide: async () => ({ ok: true as const, value: 'answered' as const }),
};

function renderCard(card: Card, theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  return render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={actions}>
        <CardView card={card} />
      </CardActionsProvider>
    </I18nProvider>,
  );
}

/**
 * Text a person sees or hears, minus what the model or user wrote ([data-user-content]) and machine values
 * (model names and ids, translate="no"), as the end-to-end pseudo-locale check skips them.
 */
function translatableText(root: HTMLElement): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim();
    // As e2e/inspect.ts: a <time>'s words are Intl's, which the pseudo-locale has no data for.
    if (text && !walker.currentNode.parentElement?.closest('[data-user-content], [translate="no"], time'))
      found.push(text);
  }
  for (const el of root.querySelectorAll('[aria-label], [title], [placeholder]')) {
    for (const name of ['aria-label', 'title', 'placeholder']) {
      const value = el.getAttribute(name)?.trim();
      if (value) found.push(value);
    }
  }
  return found;
}

it('maps every card type in core to a component and fixtures (one place on each side)', () => {
  expect(Object.keys(CARD_COMPONENTS).sort()).toEqual([...CARD_TYPES].sort());
  expect(Object.keys(CARD_FIXTURES).sort()).toEqual([...CARD_TYPES].sort());
});

describe.each(['en', 'en-XA'] as const)('cards in %s', (locale) => {
  beforeAll(async () => {
    await activateLocale(locale);
  });
  afterAll(async () => {
    await activateLocale('en');
    delete document.documentElement.dataset.theme;
  });

  // React's useId differs between two renders; the ids it makes aren't markup that could depend on the theme.
  const withoutIds = (html: string) => html.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_/g, 'ID');

  it.each(fixtures)('$label renders the same in light and dark', ({ card }) => {
    const light = renderCard(card, 'light');
    const lightHtml = withoutIds(light.container.innerHTML);
    expect(light.container.querySelector(`[data-card-type="${card.type}"]`)).not.toBeNull();
    light.unmount();
    const dark = renderCard(card, 'dark');
    expect(withoutIds(dark.container.innerHTML)).toBe(lightHtml);
    dark.unmount();
  });

  if (locale === 'en-XA') {
    it.each(fixtures)('$label has no untranslated text', ({ card }) => {
      const { container } = renderCard(card, 'light');
      const text = translatableText(container);
      expect(text.length).toBeGreaterThan(0);
      // Lingui's pseudo-locale accents every letter except v and x: three plain
      // ASCII letters in a row never went through the catalogue.
      expect(text.filter((value) => /[A-Za-z]{3,}/.test(value))).toEqual([]);
    });
  }
});
