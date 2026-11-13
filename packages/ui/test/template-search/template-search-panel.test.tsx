// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL: the Templates page's search results under its field. What you can search by before you type, bones while
 * the first answer loads, the cause and Try again when it fails; then the results, each with what matched it (words,
 * meaning, or a slot's intent as the template wrote it), an honest line while search reads words only, and a line
 * that says so when nothing matches.
 */
import type { Id, TemplateSearchHit, TemplateSearchResult } from '@taalcut/core';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplateSearchPanel, type TemplateSearchView } from '../../src/index';
import { summaryOf, templateId } from '../fit/fit-fixture';
import { wrap } from '../make-fixture';

const SLOT = '01K7C5M6Q8800000000000000S' as Id<'TemplateSlot'>;

const FEET = { index: 2, intent: 'close up of feet walking in the sand' };

const hit = (
  n: number,
  name: string,
  matchedBy: TemplateSearchHit['matchedBy'],
  slot?: TemplateSearchHit['slot'],
): TemplateSearchHit => ({
  summary: summaryOf(n, name),
  score: 1 - n / 10,
  matchedBy,
  slotId: slot ? SLOT : null,
  ...(slot ? { slot } : {}),
});

const resultOf = (
  hits: TemplateSearchHit[],
  degraded: 'keyword-only' | null = null,
): TemplateSearchResult => ({
  hits,
  degraded,
  fusion: 'template-search-v1',
});

const ready = (result: TemplateSearchResult, settling = false): TemplateSearchView => ({
  kind: 'ready',
  words: 'sand',
  result,
  settling,
});

function show(view: TemplateSearchView, active: number | null = null) {
  const handlers = { onActive: vi.fn(), onOpen: vi.fn(), onRetry: vi.fn() };
  wrap(
    <TemplateSearchPanel
      view={view}
      listId="results"
      optionId={(index) => `result-${index}`}
      active={active}
      {...handlers}
    />,
  );
  return handlers;
}

const options = () =>
  within(screen.getByRole('listbox', { name: 'Matching templates' })).getAllByRole('option');

describe('template search results', () => {
  it('says what you can search by before you type', () => {
    show({ kind: 'empty' });
    expect(
      screen.getByText('Search by a template’s name, what it’s about, or a shot it needs.'),
    ).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows bones while the first answer loads', () => {
    show({ kind: 'loading' });
    expect(document.querySelector('[data-slot=skeleton-lines]')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading');
  });

  it('says why a search failed, with Try again', () => {
    const error = { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true };
    const { onRetry } = show({ kind: 'failed', error });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('lists the results with what matched each: words, meaning, a slot’s intent as written', () => {
    show(
      ready(
        resultOf([
          hit(1, 'Beach day', ['slot', 'words'], FEET),
          hit(2, 'Coffee by the sea', ['meaning']),
          hit(3, 'Trail run', ['slot'], FEET),
        ]),
      ),
    );
    const [beach, sea, trail] = options();
    expect(beach?.textContent).toContain('Beach day');
    expect(beach?.textContent).toContain('4 slots');
    expect(beach?.querySelector('[data-slot=matched-by]')?.textContent).toBe(
      'Matched by words · slot 3’s intent: close up of feet walking in the sand',
    );
    expect(sea?.querySelector('[data-slot=matched-by]')?.textContent).toBe('Matched by meaning');
    // The intent is the template's own words: never translated.
    expect(beach?.querySelector('[translate=no][data-user-content]')).toBeTruthy();
    expect(trail?.querySelector('[data-slot=matched-by]')?.textContent).toContain('slot 3’s intent');
    expect(screen.queryByText(/Matching words only/)).toBeNull();
  });

  it('says "a slot’s intent" where the hit doesn’t place its slot', () => {
    show(ready(resultOf([{ ...hit(1, 'Beach day', ['slot']), slotId: SLOT }])));
    expect(options()[0]?.querySelector('[data-slot=matched-by]')?.textContent).toBe(
      'Matched by a slot’s intent',
    );
  });

  it('ties each result to the field: its id, the active one selected, the pointer and a click', () => {
    const { onActive, onOpen } = show(
      ready(resultOf([hit(1, 'Beach day', ['words']), hit(2, 'Coffee by the sea', ['meaning'])])),
      1,
    );
    const [first, second] = options();
    expect(first?.id).toBe('result-0');
    expect([first?.getAttribute('aria-selected'), second?.getAttribute('aria-selected')]).toEqual([
      'false',
      'true',
    ]);
    if (!first) throw new Error('no first result');
    fireEvent.mouseMove(first);
    expect(onActive).toHaveBeenCalledWith(0);
    fireEvent.click(first);
    expect(onOpen).toHaveBeenCalledWith(templateId(1));
  });

  it('says it matches words only while the embedding model is missing', () => {
    show(ready(resultOf([hit(1, 'Beach day', ['words'])], 'keyword-only')));
    expect(document.querySelector('[data-slot=words-only]')?.textContent).toBe(
      'Matching words only. Searching by meaning starts when the Search model is downloaded.',
    );
    expect(options()).toHaveLength(1);
  });

  it('says when nothing matches, and why meaning didn’t look while words are all it reads', () => {
    show(ready(resultOf([])));
    expect(screen.getByRole('status').textContent).toBe(
      'No template matches “sand” by its words or its meaning.',
    );
  });

  it('says nothing has the words, and that meaning waits for the model', () => {
    show(ready(resultOf([], 'keyword-only')));
    expect(screen.getByRole('status').textContent).toBe(
      'No template has the words “sand”. Searching by meaning starts when the Search model is downloaded.',
    );
  });

  it('keeps the last results, busy, while newer words are searched', () => {
    show(ready(resultOf([hit(1, 'Beach day', ['words'])]), true));
    expect(screen.getByRole('listbox').getAttribute('aria-busy')).toBe('true');
  });
});
