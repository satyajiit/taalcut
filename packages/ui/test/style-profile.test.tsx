// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { StyleProfileView } from '@taalcut/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CardActionsProvider,
  CardView,
  STYLE_PROFILE_CARD_FIXTURES,
  STYLE_PROFILE_FIXTURES,
  STYLE_SUMMARY_SAMPLE,
  StyleProfileSummary,
} from '../src/index';

function wrap(view: StyleProfileView, extra: { level?: 2 | 3; asking?: boolean } = {}) {
  const onOpenTemplate = vi.fn();
  const onWriteAgain = vi.fn();
  const rendered = render(
    <I18nProvider i18n={i18n}>
      <StyleProfileSummary
        view={view}
        sheetUrl={(sheet) => `taalcut-template://asset/${sheet.asset}`}
        onOpenTemplate={onOpenTemplate}
        onWriteAgain={onWriteAgain}
        {...extra}
      />
    </I18nProvider>,
  );
  return { ...rendered, onOpenTemplate, onWriteAgain };
}

const summary = (container: HTMLElement) => container.querySelector('[data-slot="style-profile-summary"]');

describe('StyleProfileSummary (LRN1-STY)', () => {
  it('shows the measured numbers under the set’s heading', () => {
    const { container } = wrap(STYLE_PROFILE_FIXTURES.local);
    expect(
      screen.getByRole('heading', { level: 2, name: 'What your saved reels have in common' }),
    ).toBeTruthy();
    expect(screen.getByText('Measured from 6 templates')).toBeTruthy();
    const facts = container.querySelector('[data-slot="style-profile-facts"]');
    expect(facts?.querySelectorAll('dt')).toHaveLength(8);
    const text = facts?.textContent ?? '';
    expect(text).toContain('Most between 0.8');
    expect(text).toContain('1.7');
    expect(text).toContain('72%');
    expect(text).toContain('In the 5 videos with a beat');
    expect(text).toContain('Close-up');
    expect(text).toContain('Straight cuts');
    expect(text).toContain('Whips');
    expect(text).toContain('Large text');
    expect(text).toContain('At the top');
    expect(text).toContain('Music');
    expect(text).toContain('Loudness -9.4 LUFS');
    expect(text).toContain('Vertical (9:16)');
  });

  it('lists the most typical templates, each opened by its id, grey without a contact sheet', () => {
    const { container, onOpenTemplate } = wrap(STYLE_PROFILE_FIXTURES.local);
    const rows = container.querySelectorAll('[data-slot="style-profile-exemplar"]');
    expect(rows).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /^Three cafés, one morning/ }));
    expect(onOpenTemplate).toHaveBeenCalledWith('01K7C5M6Q8R9S0T1V2W3X4Y5E2');
    const frames = [...rows].map((row) => row.querySelector('span[aria-hidden]'));
    expect(frames[0]?.getAttribute('style')).toContain('taalcut-template://asset/1111');
    expect(frames[2]?.getAttribute('style') ?? '').not.toContain('url(');
    expect(rows[0]?.textContent).toContain('11.2s · 10 shots');
  });

  it('says where the paragraph was written: on this Mac, or by a cloud model allowed to see pictures', () => {
    const local = wrap(STYLE_PROFILE_FIXTURES.local);
    expect(screen.getByText(STYLE_SUMMARY_SAMPLE)).toBeTruthy();
    expect(local.container.querySelector('[data-written="local"]')?.textContent).toContain(
      'Written on this Mac by qwen3.5-4b',
    );
    local.unmount();
    const cloud = wrap(STYLE_PROFILE_FIXTURES.cloud);
    const line = cloud.container.querySelector('[data-written="cloud"]')?.textContent ?? '';
    expect(line).toContain('gemini-3.1-flash-lite');
    expect(line).toContain('which you allowed to see pictures');
  });

  it('is honest without a model, and asks again from Try again', () => {
    const { container, onWriteAgain } = wrap(STYLE_PROFILE_FIXTURES.noModel);
    expect(summary(container)?.querySelector('[data-summary="no_model"]')?.textContent).toContain(
      'there’s no model on this Mac that can look at frames',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onWriteAgain).toHaveBeenCalledTimes(1);
  });

  it('shows writing as a status, not yet as a sentence, and a failure with its retry', () => {
    const writing = wrap(STYLE_PROFILE_FIXTURES.writing);
    expect(screen.getByRole('status').textContent).toContain('Writing a summary');
    writing.unmount();
    const notYet = wrap(STYLE_PROFILE_FIXTURES.notYet);
    expect(notYet.container.querySelector('[data-summary="not_yet"]')).toBeTruthy();
    notYet.unmount();
    const failed = wrap(STYLE_PROFILE_FIXTURES.failed);
    expect(failed.container.querySelector('[data-summary="failed"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(failed.onWriteAgain).toHaveBeenCalledTimes(1);
  });

  it('keeps Try again loading while the ask is on its way', () => {
    wrap(STYLE_PROFILE_FIXTURES.noModel, { asking: true });
    const button = screen.getByRole('button', { name: /Try again/ });
    expect(button.getAttribute('aria-busy') === 'true' || button.hasAttribute('disabled')).toBe(true);
  });

  it('says what fills an empty set, with no numbers', () => {
    const { container } = wrap(STYLE_PROFILE_FIXTURES.empty);
    expect(container.querySelector('[data-slot="style-profile-facts"]')).toBeNull();
    expect(container.querySelector('[data-slot="style-profile-empty"]')?.textContent).toContain(
      'Turn a few of these Reels into templates',
    );
  });

  it('says a set of one has nothing to compare with yet, and lists no most like the rest', () => {
    const { container } = wrap(STYLE_PROFILE_FIXTURES.one);
    expect(
      screen.getByRole('heading', { level: 2, name: 'What these templates have in common' }),
    ).toBeTruthy();
    expect(screen.getByText('Measured from 1 template')).toBeTruthy();
    expect(container.querySelector('[data-slot="style-profile-one"]')?.textContent).toContain(
      'One template has nothing to compare with yet, so these are its own numbers. Add another to this folder',
    );
    expect(container.querySelector('[data-slot="style-profile-facts"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="style-profile-exemplars"]')).toBeNull();
    expect(screen.getByText(STYLE_SUMMARY_SAMPLE)).toBeTruthy();
    // Two or more: no such line.
    expect(
      wrap(STYLE_PROFILE_FIXTURES.local).container.querySelector('[data-slot="style-profile-one"]'),
    ).toBeNull();
  });

  it('steps its headings down inside a card', () => {
    wrap(STYLE_PROFILE_FIXTURES.local, { level: 3 });
    expect(
      screen.getByRole('heading', { level: 3, name: 'What your saved reels have in common' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Most like the rest' })).toBeTruthy();
  });
});

describe('StyleProfileChatCard (LRN1-STY, Part B)', () => {
  it('titles the card by the set, names it as written, and opens an exemplar through the card actions', () => {
    const navigate = vi.fn();
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <CardActionsProvider value={{ runFix: () => undefined, navigate }}>
          <CardView card={STYLE_PROFILE_CARD_FIXTURES.local} />
        </CardActionsProvider>
      </I18nProvider>,
    );
    expect(
      screen.getByRole('heading', { level: 3, name: 'What your saved reels have in common' }),
    ).toBeTruthy();
    expect(screen.getByText('Travel inspo').getAttribute('translate')).toBe('no');
    expect(screen.getByText('Measured from 6 templates')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Most like the rest' })).toBeTruthy();
    expect(container.querySelector('[data-written="local"]')).toBeTruthy();
    // A snapshot of what the agent read: asking again belongs to the set's page.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Golden hour in Lisbon/ }));
    expect(navigate).toHaveBeenCalledWith({ to: 'template', templateId: '01K7C5M6Q8R9S0T1V2W3X4Y5E1' });
  });

  it('says what fills an empty set', () => {
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <CardView card={STYLE_PROFILE_CARD_FIXTURES.empty} />
      </I18nProvider>,
    );
    expect(container.querySelector('[data-slot="style-profile-empty"]')).toBeTruthy();
    expect(screen.getByText('Hooks')).toBeTruthy();
  });
});
