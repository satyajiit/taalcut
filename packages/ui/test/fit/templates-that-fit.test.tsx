// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL: "Templates that fit this footage" under an import's progress. Nothing until search can find some of its
 * clips; then the best three with how much they fill, how close the match is and what they're short of; Make it
 * starts the template's flow in this chat. Each empty answer says what it means, a failed read says why with Try
 * again, and the answer is read again as clips arrive (each time they double) and when the import finishes.
 */
import type { Card, FitPool, FitTemplatesResult } from '@taalcut/core';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_FIXTURES, CardView, fitRevision, TemplatesThatFit, type CardActions } from '../../src/index';
import { wrap } from '../make-fixture';
import { FITS, resultOf, SOURCE, templateId } from './fit-fixture';

const ok = { ok: true as const, value: undefined };
const timeout = { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true };

type Reader = (pool: FitPool, limit: number) => Promise<FitTemplatesResult | { failed: typeof timeout }>;

/** The node with these fits to read (none: the host can't fit) and these actions. */
const show = (node: ReactNode, fitTemplates: Reader | undefined, actions: CardActions = {}) =>
  wrap(node, actions, fitTemplates ? { fitTemplates } : {});

/** An import moving through these (searchable, finished) steps, one per click on Next. */
function Growing({ steps }: { steps: readonly (readonly [number, boolean])[] }) {
  const [step, setStep] = useState(0);
  const [searchable, finished] = steps[step] ?? [0, false];
  return (
    <>
      <button type="button" onClick={() => setStep((at) => at + 1)}>
        Next
      </button>
      <TemplatesThatFit sourceId={SOURCE} searchable={searchable} finished={finished} />
    </>
  );
}

const section = () => screen.getByRole('region', { name: 'Templates that fit this footage' });
const rows = () =>
  within(section())
    .queryAllByRole('listitem')
    .filter((item) => item.dataset.slot === 'fit-row');
const settle = () => act(async () => undefined);

describe('templates that fit this footage', () => {
  it('shows nothing and reads nothing until some clip is searchable', async () => {
    const read = vi.fn<Reader>(async () => resultOf(FITS));
    show(<TemplatesThatFit sourceId={SOURCE} searchable={0} finished={false} />, read);
    await settle();
    expect(screen.queryByRole('region')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('shows nothing where the host cannot fit', async () => {
    show(<TemplatesThatFit sourceId={SOURCE} searchable={12} finished={false} />, undefined);
    await settle();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('lists the best three that the clips fill at all: facts, match and what each is short of', async () => {
    const read = vi.fn<Reader>(async () => resultOf(FITS));
    show(<TemplatesThatFit sourceId={SOURCE} searchable={12} finished={false} />, read);
    expect(section().querySelector('[data-slot=skeleton-lines]')).toBeTruthy();
    await settle();
    expect(read).toHaveBeenCalledWith({ sourceIds: [SOURCE] }, 3);
    const [chai, market, night] = rows();
    expect(rows()).toHaveLength(3);
    expect(chai?.textContent).toContain('Chai at dawn');
    expect(chai?.textContent).toContain('82% match · Fills all 4 slots');
    expect(chai?.querySelector('[data-slot=fit-missing]')).toBeNull();
    expect(market?.textContent).toContain('53% match · Fills 3 of 4 slots');
    expect(market?.textContent).toContain('Missing slot 4: Steam over the pot (its clips fill other slots)');
    // At most two missing slots are named; the rest are counted.
    expect(night?.textContent).toContain('26% match · Fills 2 of 5 slots');
    expect(night?.textContent).toContain(
      'Missing slot 3: Neon sign, slow push-in (only clips the other way round)',
    );
    expect(night?.textContent).toContain('Missing slot 4: Crowd from above (no clip long or sharp enough)');
    expect(night?.textContent).toContain('and 1 more slot');
    // A template that none of the clips fill is left out.
    expect(section().textContent).not.toContain('Snow day');
  });

  it('marks the template names and the intents as the person’s own text, not translated', async () => {
    show(<TemplatesThatFit sourceId={SOURCE} searchable={12} finished={false} />, async () => resultOf(FITS));
    await settle();
    const name = screen.getByText('Market walk');
    const intent = screen.getByText('Steam over the pot');
    for (const node of [name, intent]) expect(node.getAttribute('translate')).toBe('no');
  });

  it('Make it starts the template’s flow in the chat and says so; the others stay open', async () => {
    const startFlow = vi.fn(async () => ok);
    show(
      <TemplatesThatFit sourceId={SOURCE} searchable={12} finished={false} />,
      async () => resultOf(FITS),
      {
        startFlow,
      },
    );
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make a video with “Market walk”' }));
    });
    expect(startFlow).toHaveBeenCalledWith(
      { path: 'template', templateId: templateId(2) },
      'Make a video with my template “Market walk”',
    );
    const market = rows()[1];
    expect(market && within(market).getByRole('status').textContent).toContain('Started in this chat');
    expect(screen.getByRole('button', { name: 'Make a video with “Market walk”' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Make a video with “Chai at dawn”' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('a start that fails says why under its row, and Make it can be tried again', async () => {
    const startFlow = vi.fn(async () => ({ ok: false as const, error: timeout }));
    show(
      <TemplatesThatFit sourceId={SOURCE} searchable={12} finished={false} />,
      async () => resultOf(FITS),
      {
        startFlow,
      },
    );
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make a video with “Chai at dawn”' }));
    });
    const chai = rows()[0];
    expect(chai && within(chai).getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make a video with “Chai at dawn”' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('without a way to start a flow the rows only inform', async () => {
    show(<TemplatesThatFit sourceId={SOURCE} searchable={12} finished={false} />, async () => resultOf(FITS));
    await settle();
    expect(rows()).toHaveLength(3);
    expect(within(section()).queryAllByRole('button')).toHaveLength(0);
  });

  it.each([
    [
      'no saved templates',
      resultOf([], { templates: 0 }),
      'Save a template and this shows how well these clips fill it.',
    ],
    [
      'no clip matchable yet',
      resultOf(FITS, { poolShots: 0 }),
      'None of these clips can be matched yet. This fills in as they become searchable.',
    ],
    ['nothing filled', resultOf(FITS.slice(3)), 'None of your templates fit these clips yet.'],
  ])('%s: one honest line', async (_name, result, line) => {
    show(<TemplatesThatFit sourceId={SOURCE} searchable={12} finished={false} />, async () => result);
    await settle();
    expect(section().textContent).toContain(line);
    expect(rows()).toHaveLength(0);
  });

  it('a failed read says why with Try again, which reads again', async () => {
    let failing = true;
    const read = vi.fn<Reader>(async () => (failing ? { failed: timeout } : resultOf(FITS)));
    show(<TemplatesThatFit sourceId={SOURCE} searchable={12} finished={false} />, read);
    await settle();
    expect(within(section()).getByRole('alert')).toBeTruthy();
    failing = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(3);
    expect(within(section()).queryByRole('alert')).toBeNull();
  });

  it('reads again each time the searchable clips double and when the import finishes, the rows staying', async () => {
    const read = vi.fn<Reader>(async () => resultOf(FITS));
    show(
      <Growing
        steps={[
          [5, false],
          [7, false],
          [8, false],
          [40, true],
        ]}
      />,
      read,
    );
    const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await settle();
    // 5 to 7 searchable: still the same doubling, no read.
    act(next);
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    // 8: read again, the answer on screen staying while the new one comes.
    act(next);
    expect(read).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(3);
    expect(section().querySelector('[data-slot=skeleton-lines]')).toBeNull();
    await settle();
    // Finished: once more.
    act(next);
    await settle();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('fitRevision buckets by doubling, then finishes', () => {
    expect([1, 2, 3, 4, 7, 8, 40].map((n) => fitRevision(n, false))).toEqual([
      'searchable-0',
      'searchable-1',
      'searchable-1',
      'searchable-2',
      'searchable-2',
      'searchable-3',
      'searchable-5',
    ]);
    expect(fitRevision(40, true)).toBe('finished');
  });

  it('sits under the import card’s progress once clips are searchable', async () => {
    const read = vi.fn<Reader>(async () => resultOf(FITS));
    const card: Card | undefined = CARD_FIXTURES.importProgress['indexing'];
    if (!card) throw new Error('no importProgress fixture "indexing"');
    show(<CardView card={card} />, read);
    await settle();
    expect(read).toHaveBeenCalledWith({ sourceIds: [SOURCE] }, 3);
    expect(rows()).toHaveLength(3);
  });
});
