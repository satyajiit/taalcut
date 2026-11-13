// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Memory's learned casting weights in the kit (LRN1-PREF): the lean in words, the provenance, Adjust and
 * Reset, and an editor that shows what the rules give it. The kit imports no core code, so these tests stand in
 * for core's rules; apps/renderer `test/settings/casting-weights-editor.test.tsx` runs the same editor on core's
 * (every move inside the bounds at the total, every save accepted by memoryItemProblems).
 */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CastingWeightKey, CastingWeights, MemoryId, TaalcutError } from '@taalcut/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CastingWeightsItem,
  castingWeightsSentence,
  type CastingWeightsData,
  type CastingWeightsItemProps,
  type CastingWeightsLean,
  type CastingWeightsRules,
} from '../src/index';

const DEFAULTS: CastingWeights = { intent: 0.4, motion: 0.15, quality: 0.15, subject: 0.15, energy: 0.15 };
const LEARNED: CastingWeights = { intent: 0.38, motion: 0.24, quality: 0.11, subject: 0.12, energy: 0.15 };
const LEAN: CastingWeightsLean = { toward: ['motion'], less: ['quality', 'subject'] };
const PARTS: readonly CastingWeightKey[] = ['intent', 'motion', 'quality', 'subject', 'energy'];
const data = (weights: CastingWeights, pairs = 18): CastingWeightsData => ({
  kind: 'casting-weights',
  configVersion: 'casting.v1',
  defaults: DEFAULTS,
  weights,
  pairs,
});
// A fixture id, branded as the kit's fixtures brand theirs.
const item = { id: '01K7C5M6Q8R9S0T1V2W3X4Y5ZM' as MemoryId, updatedAt: 1_000 };

/** Stand-in rules: casting.v1's reach, a fit that returns what it is given, and a fixed lean. */
function standIn(fit: CastingWeightsRules['fit'] = (weights) => weights): CastingWeightsRules {
  const others = { min: 0.075, max: 0.3 };
  return {
    parts: PARTS,
    reach: {
      intent: { min: 0.2, max: 0.7 },
      motion: others,
      quality: others,
      subject: others,
      energy: others,
    },
    units: 1000,
    fit: vi.fn(fit),
    lean: vi.fn(() => LEAN),
  };
}

function show(props: Partial<CastingWeightsItemProps> = {}) {
  const handlers = { onEdit: vi.fn(), onCancel: vi.fn(), onSave: vi.fn(), onReset: vi.fn() };
  const rules = props.rules ?? standIn();
  render(
    <I18nProvider i18n={i18n}>
      <CastingWeightsItem
        item={item}
        data={data(LEARNED)}
        rules={rules}
        editing={false}
        busy={null}
        now={2_000}
        {...handlers}
        {...props}
      />
    </I18nProvider>,
  );
  return { ...handlers, rules };
}

const slider = (name: string) => screen.getByRole<HTMLInputElement>('slider', { name });
const values = (): CastingWeights => {
  const read = (key: string) =>
    Number(document.querySelector<HTMLInputElement>(`input[data-part=${key}]`)?.value ?? Number.NaN);
  return {
    intent: read('intent'),
    motion: read('motion'),
    quality: read('quality'),
    subject: read('subject'),
    energy: read('energy'),
  };
};

describe('casting weights in words (LRN1-PREF)', () => {
  it('says how they lean, strongest first, in a sentence of its own', () => {
    expect(castingWeightsSentence(i18n, LEAN)).toBe(
      'When picking shots, leans toward shots whose camera motion matches the template, and less on picture ' +
        'quality and matching people and subject.',
    );
    expect(castingWeightsSentence(i18n, { toward: [], less: [] })).toBe(
      'Picks shots with the default balance of description, camera motion, quality, subject and energy.',
    );
    expect(castingWeightsSentence(i18n, { toward: ['intent'], less: ['quality'] })).toBe(
      'When picking shots, leans toward shots that match what the slot describes, and less on picture quality.',
    );
    expect(castingWeightsSentence(i18n, { toward: [], less: ['energy'] })).toBe(
      'When picking shots, puts less weight on matching energy.',
    );
  });
});

describe('CastingWeightsItem (LRN1-PREF)', () => {
  it('shows the lean, the violet Learned badge and how many choices taught it, with Adjust and Reset', () => {
    const handlers = show();
    const row = document.querySelector<HTMLElement>('[data-memory-kind=casting-weights]');
    if (!row) throw new Error('no row');
    expect(within(row).getByText(/^When picking shots, leans toward/)).toBeTruthy();
    expect(handlers.rules.lean).toHaveBeenCalledWith(LEARNED);
    expect(row.querySelector('[data-source=learned]')?.textContent).toBe('Learned');
    expect(row.textContent).toContain('From 18 choices you made');
    expect(row.querySelector('[data-adjusted]')).toBeNull();
    expect(row.querySelector('time')?.getAttribute('dateTime')).toBe(new Date(1_000).toISOString());
    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    expect(handlers.onEdit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to the defaults' }));
    expect(handlers.onReset).toHaveBeenCalledOnce();
  });

  it('says "Adjusted by you" in teal once a person set them', () => {
    show({ data: data(LEARNED, 0) });
    const adjusted = document.querySelector('[data-adjusted=you]');
    expect(adjusted?.textContent).toBe('Adjusted by you');
    expect(adjusted?.className).toContain('text-you-strong');
    expect(document.body.textContent).not.toContain('choices you made');
  });

  it('Reset spins while the item is deleted, and another row’s change makes both wait', () => {
    show({ busy: 'delete' });
    expect(screen.getByRole('button', { name: 'Reset to the defaults' }).getAttribute('data-state')).toBe(
      'loading',
    );
    expect(screen.getByRole('button', { name: 'Adjust' })).toHaveProperty('disabled', true);
  });
});

describe('the casting weights editor (LRN1-PREF)', () => {
  it('opens on the first part; a moved part goes through the rules, turns teal, and Save gets the draft', () => {
    const handlers = show({ editing: true });
    expect(document.activeElement).toBe(slider('Matches the description'));
    expect(screen.getAllByRole('slider').map((input) => input.dataset['part'])).toEqual(PARTS);
    expect(slider('Picture quality').className).toContain('accent-ai-strong');
    expect(slider('Picture quality').getAttribute('aria-valuetext')).toBe('11%, learned; default 15%');

    fireEvent.keyDown(slider('Picture quality'), { key: 'ArrowRight' });
    expect(handlers.rules.fit).toHaveBeenLastCalledWith({ ...LEARNED, quality: 0.12 }, 'quality');
    expect(values().quality).toBe(0.12);
    expect(slider('Picture quality').dataset['yours']).toBe('true');
    expect(slider('Picture quality').className).toContain('accent-you-strong');
    expect(slider('Picture quality').getAttribute('aria-valuetext')).toBe('12%, set by you; default 15%');
    expect(slider('Camera motion').dataset['yours']).toBe('false');

    fireEvent.keyDown(slider('Picture quality'), { key: 'PageUp' });
    expect(values().quality).toBe(0.17);
    fireEvent.keyDown(slider('Matches the description'), { key: 'End' });
    expect(values().intent).toBe(0.7);
    fireEvent.keyDown(slider('Matches the description'), { key: 'Home' });
    expect(values().intent).toBe(0.2);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onSave).toHaveBeenCalledWith(values());
  });

  it('shows what the rules make of a move: the others share the difference', () => {
    const shared: CastingWeights = { intent: 0.37, motion: 0.24, quality: 0.14, subject: 0.11, energy: 0.14 };
    show({ editing: true, rules: standIn(() => shared) });
    fireEvent.keyDown(slider('Picture quality'), { key: 'PageUp' });
    expect(values()).toEqual(shared);
    expect(slider('Picture quality').dataset['yours']).toBe('true');
    expect(slider('Matches the description').dataset['yours']).toBe('false');
  });

  it('a pointer drag sets the part where it was let go, kept within its reach', () => {
    show({ editing: true });
    fireEvent.change(slider('Camera motion'), { target: { value: '0.2' } });
    expect(values().motion).toBe(0.2);
    fireEvent.change(slider('Camera motion'), { target: { value: '0.9' } });
    expect(values().motion).toBe(0.3);
  });

  it('Escape and Cancel leave it as it was', () => {
    const handlers = show({ editing: true });
    fireEvent.keyDown(slider('Camera motion'), { key: 'Escape' });
    expect(handlers.onCancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(2);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it('while saving the parts wait and Save spins; a failure says why under the grid', () => {
    const error: TaalcutError = {
      code: 'core.conflict',
      messageKey: 'errors.core.conflict',
      retryable: false,
    };
    show({ editing: true, busy: 'save', error });
    for (const input of screen.getAllByRole('slider')) expect(input).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('data-state')).toBe('loading');
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('a person’s own weights open as theirs', () => {
    show({ editing: true, data: data(LEARNED, 0) });
    for (const input of screen.getAllByRole('slider')) expect(input.dataset['yours']).toBe('true');
  });
});
