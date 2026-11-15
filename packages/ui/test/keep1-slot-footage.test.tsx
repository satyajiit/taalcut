// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { Template } from '@taalcut/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorMessage, TemplateReview } from '../src/index';
import { editWords } from '../src/templates/edit-words';
import { reelChoiceBlocked, SlotFootage } from '../src/templates/slot-footage';
import { reviewEditCommand } from '../src/templates/use-review-edits';
import { templateFixture } from './template-fixture';

// KEEP1: whose footage a slot plays in the breakdown review, and the person's say in it.

type Footage = NonNullable<Template['slots'][number]['footage']>;
const ok = <T,>(value: T) => ({ ok: true as const, value });
const REASON = 'A film scene the joke lands on';

/** The four-slot reel with a statement on some slots (by index). */
function reel(footage: Readonly<Record<number, Footage>>, overrides: Partial<Template> = {}): Template {
  const base = templateFixture(overrides);
  return {
    ...base,
    slots: base.slots.map((slot, i) => (footage[i] ? { ...slot, footage: footage[i] } : slot)),
  };
}
const kept = (by: Footage['by'] = 'analyst', reason: string | null = REASON): Footage => ({
  from: 'reel',
  by,
  reason,
});

function control(template: Template, index: number, hasReel = true, pending: string | null = null) {
  const run = vi.fn(async () => true);
  render(
    <I18nProvider i18n={i18n}>
      <SlotFootage
        template={template}
        index={index}
        hasReel={hasReel}
        edits={{ run, pending: pending as never }}
      />
    </I18nProvider>,
  );
  return run;
}
const status = () => document.querySelector('[data-slot=slot-footage-status]')?.textContent;
const why = () => document.querySelector('[data-slot=slot-footage-why]')?.textContent ?? null;
const choice = (name: RegExp | string) => screen.getByRole('radio', { name });

describe('whose clip a slot plays (KEEP1)', () => {
  it('says a reel slot is the reel’s own, whose reading that is and why, and lets the person use their clip', () => {
    const template = reel({ 1: kept() });
    const run = control(template, 1);
    expect(status()).toBe('This shot is the reel’s own clip');
    const root = document.querySelector<HTMLElement>('[data-slot=slot-footage]')!;
    expect(root.dataset.from).toBe('reel');
    expect(within(root).getByLabelText('Taalcut’s reading')).toBeTruthy();
    // The reason is model text written from someone else's video: shown as text, marked as content.
    const reason = within(root).getByText(REASON);
    expect(reason.getAttribute('translate')).toBe('no');
    expect(reason.hasAttribute('data-user-content')).toBe(true);
    expect(
      within(root).getByText('A video made from this template keeps it. Your clips go in the other slots.'),
    ).toBeTruthy();
    const group = screen.getByRole('radiogroup', { name: 'Whose clip plays in slot 2' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((el) => el.textContent),
    ).toEqual(['Keep the reel’s clip', 'Use my clip']);
    expect(choice('Keep the reel’s clip').getAttribute('aria-checked')).toBe('true');
    expect(why()).toBeNull();
    fireEvent.click(choice('Use my clip'));
    expect(run).toHaveBeenCalledWith({ kind: 'setFootage', slotId: template.slots[1]!.id, from: 'person' });
  });

  it('says a person slot takes your clip, and Keep the reel’s clip flips it', () => {
    const template = reel({ 1: kept() });
    const run = control(template, 0);
    expect(status()).toBe('Your clip goes here');
    // Nobody stated it: no mark, no reason.
    expect(screen.queryByLabelText('Taalcut’s reading')).toBeNull();
    expect(screen.queryByText('You')).toBeNull();
    expect(choice('Use my clip').getAttribute('aria-checked')).toBe('true');
    // Picking what it already is changes nothing.
    fireEvent.click(choice('Use my clip'));
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(choice('Keep the reel’s clip'));
    expect(run).toHaveBeenCalledWith({ kind: 'setFootage', slotId: template.slots[0]!.id, from: 'reel' });
  });

  it('marks the person’s statement “You”, and keeps Taalcut’s reason as Taalcut’s', () => {
    control(reel({ 1: { from: 'person', by: 'user', reason: REASON } }), 1);
    expect(status()).toBe('Your clip goes here');
    expect(screen.getByText('You')).toBeTruthy();
    const line = document.querySelector<HTMLElement>('[data-slot=slot-footage-reason]')!;
    expect(within(line).getByLabelText('Taalcut’s reading')).toBeTruthy();
    expect(line.textContent).toBe(`Taalcut read this shot as the reel’s own clip: ${REASON}`);
  });

  it('a reel slot the person chose says “You”, with no reason when nobody gave one', () => {
    control(reel({ 2: kept('user', null) }), 2);
    expect(status()).toBe('This shot is the reel’s own clip');
    expect(screen.getByText('You')).toBeTruthy();
    expect(document.querySelector('[data-slot=slot-footage-reason]')).toBeNull();
  });

  it('Keep the reel’s clip is off, with why, when the reel’s video isn’t on this Mac', () => {
    const template = reel({});
    const run = control(template, 0, false);
    const line = 'The reel’s video isn’t on this Mac, so this slot can’t keep the reel’s clip.';
    expect(why()).toBe(line);
    const off = choice(/^Keep the reel’s clip/);
    expect(off.getAttribute('aria-disabled')).toBe('true');
    // The choice says why in its own name too.
    expect(off.textContent).toBe(`Keep the reel’s clip. ${line}`);
    fireEvent.click(off);
    expect(run).not.toHaveBeenCalled();
    expect(reelChoiceBlocked(template, 0, false)).toBe('noReel');
  });

  it('Keep the reel’s clip is off, with why, on the last slot left for your clips', () => {
    const template = reel({ 1: kept(), 2: kept(), 3: kept('user') });
    const run = control(template, 0);
    expect(why()).toBe('Your clips need at least one slot, so this one stays yours.');
    const off = choice(/^Keep the reel’s clip/);
    expect(off.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(off);
    expect(run).not.toHaveBeenCalled();
    expect(reelChoiceBlocked(template, 0, true)).toBe('last');
    // With another slot still yours, it can be picked.
    expect(reelChoiceBlocked(reel({ 1: kept() }), 0, true)).toBeNull();
  });

  it('a reel slot whose reel isn’t on this Mac says so, and can still take your clip', () => {
    const template = reel({ 1: kept() });
    const run = control(template, 1, false);
    expect(why()).toBe(
      'The reel’s video isn’t on this Mac. Get it before you make a video, or use your clip here.',
    );
    expect(choice('Keep the reel’s clip').getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(choice('Use my clip'));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits while another fix is on its way, and holds while its own is', () => {
    const template = reel({ 1: kept() });
    const run = control(template, 1, true, 'describe');
    expect(screen.getByRole('radiogroup').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(choice('Use my clip'));
    expect(run).not.toHaveBeenCalled();
  });

  it('shows nothing for a template that was not made from a reel, and words only when read-only', () => {
    const format = reel(
      {},
      {
        origin: {
          kind: 'format',
          formatId: 'vlog',
          formatVersion: '1',
          target: { value: 150, rate: { num: 30, den: 1 } },
          brief: 'A quick answer',
        },
      },
    );
    const view = render(
      <I18nProvider i18n={i18n}>
        <SlotFootage template={format} index={0} hasReel edits={null} />
      </I18nProvider>,
    );
    expect(document.querySelector('[data-slot=slot-footage]')).toBeNull();
    view.rerender(
      <I18nProvider i18n={i18n}>
        <SlotFootage template={reel({ 1: kept() })} index={1} hasReel edits={null} />
      </I18nProvider>,
    );
    expect(status()).toBe('This shot is the reel’s own clip');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('the review with reel slots (KEEP1)', () => {
  // jsdom plays nothing, and says so on the console: picking a slot plays its stretch of the reel.
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReturnValue();
  });

  function view(template: Template) {
    const dispatch = vi.fn(async (_name: string, _payload: unknown) =>
      ok({ result: { templateId: template.id, version: template.version + 1 } }),
    );
    render(
      <I18nProvider i18n={i18n}>
        <TemplateReview
          variant="sheet"
          template={template}
          reelUrl="taalcut-media://template/reel"
          sheetUrl={null}
          projectId={null}
          dispatch={dispatch}
          undo={async () => ok(null)}
        />
      </I18nProvider>,
    );
    return dispatch;
  }

  it('marks a reel slot in the strip, and a pick makes template.slot.setFootage and says what it did', async () => {
    const template = reel({ 1: kept(), 2: kept() });
    const dispatch = view(template);
    const strip = screen.getByRole('listbox', { name: 'Slots' });
    const names = within(strip)
      .getAllByRole('option')
      .map((el) => el.getAttribute('aria-label'));
    expect(names[0]).not.toContain('The reel’s own clip');
    expect(names[1]).toContain('The reel’s own clip');
    expect(strip.querySelectorAll('[data-slot=reel-mark]')).toHaveLength(2);
    fireEvent.click(within(strip).getAllByRole('option')[1]!);
    expect(status()).toBe('This shot is the reel’s own clip');
    await act(async () => fireEvent.click(choice('Use my clip')));
    expect(dispatch).toHaveBeenLastCalledWith('template.slot.setFootage', {
      projectId: null,
      templateId: template.id,
      baseVersion: template.version,
      slotId: template.slots[1]!.id,
      from: 'person',
    });
    expect(document.querySelector('[data-slot=review-said]')?.textContent).toBe('Slot 2 uses your clip');
  });
});

describe('footage words and commands (KEEP1)', () => {
  it('makes template.slot.setFootage on the version on screen', () => {
    const template = reel({ 1: kept() });
    const slotId = template.slots[0]!.id;
    expect(reviewEditCommand(template, null, { kind: 'setFootage', slotId, from: 'reel' }, 3)).toEqual({
      name: 'template.slot.setFootage',
      payload: { projectId: null, templateId: template.id, baseVersion: 3, slotId, from: 'reel' },
    });
  });

  it('says what a pick did, beside Undo', () => {
    const template = reel({ 1: kept() });
    const words = (index: number, from: 'person' | 'reel') =>
      editWords(i18n, template, { kind: 'setFootage', slotId: template.slots[index]!.id, from });
    expect(words(0, 'reel')).toBe('Slot 1 keeps the reel’s clip');
    expect(words(1, 'person')).toBe('Slot 2 uses your clip');
  });

  it('has a sentence for each refusal and for a reel that is not on this Mac', () => {
    const say = (code: string) =>
      errorMessage(i18n, { code, messageKey: `errors.${code}`, retryable: false });
    expect(say('templates.no_person_slot')).toBe(
      'Your clips need at least one slot, so this one stays yours.',
    );
    expect(say('templates.no_reel')).toBe(
      'This template wasn’t made from a reel, so there is no reel clip to keep.',
    );
    expect(say('timeline.reel_missing')).toBe(
      'This video keeps clips from the reel, and the reel’s video isn’t on this Mac. Get it, then try again.',
    );
  });
});
