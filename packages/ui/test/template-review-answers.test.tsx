// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { Template, TemplateProposals } from '@taalcut/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplateReview } from '../src/index';
import { templateFixture } from './template-fixture';

// The review's answers beside its doubts, Tell Taalcut per slot, and Accept all's truthful outcome (BRK1-REV P2s).

const ok = <T,>(value: T) => ({ ok: true as const, value });

/** Slot 2's cut is unsure. */
function doubted(): Template {
  const base = templateFixture();
  return {
    ...base,
    slots: base.slots.map((slot, i) =>
      i === 1 ? { ...slot, doubts: [{ reason: 'cutUnsure', confidence: 0.4 }] } : slot,
    ),
  };
}

function view(template: Template, propose?: (input: unknown) => Promise<unknown>) {
  const dispatch = vi.fn(async (_name: string, _payload: unknown) =>
    ok({ result: { templateId: template.id, version: template.version + 1 } }),
  );
  const ui = (current: Template) => (
    <I18nProvider i18n={i18n}>
      <TemplateReview
        variant="sheet"
        template={current}
        reelUrl={null}
        sheetUrl={null}
        projectId={null}
        dispatch={dispatch}
        undo={async () => ok(null)}
        propose={propose as never}
      />
    </I18nProvider>
  );
  const rendered = render(ui(template));
  return { dispatch, rerender: (next: Template) => rendered.rerender(ui(next)) };
}

const said = () => document.querySelector('[data-slot=review-said]')?.textContent;
const at = (template: Template) => ({
  projectId: null,
  templateId: template.id,
  baseVersion: template.version,
});

function answerOf(proposals: unknown[]): TemplateProposals {
  return {
    baseVersion: 1,
    proposals: proposals as TemplateProposals['proposals'],
    dropped: 0,
    note: null,
    model: { provider: 'Ollama', model: 'gemma3:4b', local: true },
  };
}

describe('the review’s answers (BRK1-REV)', () => {
  it('answers an unsure cut beside it: It’s a cut keeps it, and says so', async () => {
    const template = doubted();
    const { dispatch } = view(template);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'It’s a cut' })));
    expect(dispatch).toHaveBeenLastCalledWith('template.doubt.dismiss', {
      ...at(template),
      target: { kind: 'slot', slotId: template.slots[1]!.id },
      reason: 'cutUnsure',
    });
    expect(said()).toBe('The cut before slot 2 kept');
  });

  it('Not a cut joins the slot to the one before it', async () => {
    const template = doubted();
    const { dispatch } = view(template);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Not a cut' })));
    expect(dispatch).toHaveBeenLastCalledWith(
      'template.slot.merge',
      expect.objectContaining({ slotIds: [template.slots[0]!.id, template.slots[1]!.id] }),
    );
    expect(said()).toBe('The cut before slot 2 is gone');
  });

  it('Tell Taalcut belongs to the slot it was asked about, even when its answer comes after a move', async () => {
    const template = doubted();
    let answer!: (value: unknown) => void;
    const propose = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    view(template, propose);
    fireEvent.click(screen.getByRole('button', { name: 'Tell Taalcut' }));
    const tell = () => document.querySelector<HTMLElement>('[data-slot=tell-taalcut]')!;
    fireEvent.change(within(tell()).getByRole('textbox'), { target: { value: 'One shot, not a cut' } });
    await act(async () => fireEvent.click(within(tell()).getByRole('button', { name: 'Ask for changes' })));
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ slotIds: [template.slots[1]!.id] }));
    // On to slot 3 before the answer comes: its own (empty) draft, and no answer.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await act(async () =>
      answer(
        ok(
          answerOf([
            {
              id: 'p1',
              command: 'template.slot.merge',
              payload: { slotIds: [template.slots[0]!.id, template.slots[1]!.id] },
              why: 'One shot.',
            },
          ]),
        ),
      ),
    );
    expect((within(tell()).getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(tell().querySelector('[data-slot=proposal]')).toBeNull();
    // Back on slot 2: its words and its answer.
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect((within(tell()).getByRole('textbox') as HTMLTextAreaElement).value).toBe('One shot, not a cut');
    expect(tell().querySelector('[data-slot=proposal]')).not.toBeNull();
  });

  it('a description a later merge replaced says so instead of Accepted', async () => {
    const template = doubted();
    const merge = {
      id: 'p1',
      command: 'template.slot.merge',
      payload: { slotIds: [template.slots[0]!.id, template.slots[1]!.id], intentFrom: template.slots[0]!.id },
      why: 'One shot.',
    };
    const edit = {
      id: 'p2',
      command: 'template.slot.editIntent',
      payload: { slotId: template.slots[1]!.id, intent: { text: 'Steam, held still' } },
      why: 'Says what moves.',
    };
    const { rerender } = view(template, async () => ok(answerOf([merge, edit])));
    fireEvent.click(screen.getByRole('button', { name: 'Tell Taalcut' }));
    const tell = () => document.querySelector<HTMLElement>('[data-slot=tell-taalcut]')!;
    fireEvent.change(within(tell()).getByRole('textbox'), { target: { value: 'One shot, and vague' } });
    await act(async () => fireEvent.click(within(tell()).getByRole('button', { name: 'Ask for changes' })));
    const rows = () => [...tell().querySelectorAll<HTMLElement>('[data-slot=proposal]')];
    await waitFor(() => expect(rows()).toHaveLength(2));
    // The description first, then the merge, by hand.
    await act(async () => fireEvent.click(within(rows()[1]!).getByRole('button', { name: 'Accept' })));
    await act(async () => fireEvent.click(within(rows()[0]!).getByRole('button', { name: 'Accept' })));
    // The merged version arrives: slot 2 is gone, so its description didn't survive the merge.
    const merged: Template = { ...template, version: 3, slots: template.slots.filter((_, i) => i !== 1) };
    rerender(merged);
    await waitFor(() => expect(rows()[1]!.getAttribute('data-state')).toBe('replaced'));
    expect(rows()[1]!.textContent).toContain('Replaced by the merge');
    expect(rows()[0]!.getAttribute('data-state')).toBe('accepted');
  });

  it('Accept all merges first, and what the merge took says it no longer applies', async () => {
    const template = doubted();
    const merge = {
      id: 'p1',
      command: 'template.slot.merge',
      payload: { slotIds: [template.slots[0]!.id, template.slots[1]!.id], intentFrom: template.slots[0]!.id },
      why: 'One shot.',
    };
    const edit = {
      id: 'p2',
      command: 'template.slot.editIntent',
      payload: { slotId: template.slots[1]!.id, intent: { text: 'Steam, held still' } },
      why: 'Says what moves.',
    };
    const merged: Template = { ...template, version: 2, slots: template.slots.filter((_, i) => i !== 1) };
    const { dispatch, rerender } = view(template, async () => ok(answerOf([edit, merge])));
    // The merge's version arrives a moment after its receipt, as the page reads it.
    dispatch.mockImplementation(async (name: string) => {
      if (name === 'template.slot.merge') window.setTimeout(() => rerender(merged), 20);
      return ok({ result: { templateId: template.id, version: 2 } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tell Taalcut' }));
    const tell = () => document.querySelector<HTMLElement>('[data-slot=tell-taalcut]')!;
    fireEvent.change(within(tell()).getByRole('textbox'), { target: { value: 'One shot, and vague' } });
    await act(async () => fireEvent.click(within(tell()).getByRole('button', { name: 'Ask for changes' })));
    await act(async () =>
      fireEvent.click(await within(tell()).findByRole('button', { name: 'Accept all 2' })),
    );
    const rows = () => [...tell().querySelectorAll<HTMLElement>('[data-slot=proposal]')];
    await waitFor(() => expect(rows()[0]!.getAttribute('data-state')).toBe('gone'));
    expect(rows()[1]!.getAttribute('data-state')).toBe('accepted');
    expect(dispatch.mock.calls.map(([name]) => name)).toEqual(['template.slot.merge']);
  });

  it('Add the credit writes the sound’s credit in place, with an https link or none', async () => {
    const base = doubted();
    const template: Template = {
      ...base,
      doubts: [{ reason: 'tempoMaybeHalfOrDouble' }, { reason: 'soundCreditMissing' }],
    };
    const { dispatch } = view(template);
    // The tempo is current; the sound's credit stays in view as a line that goes to it.
    const reel = () => document.querySelector<HTMLElement>('[data-slot=reel-doubts]')!;
    fireEvent.click(within(reel()).getByRole('button', { name: /whose sound it is/ }));
    fireEvent.click(within(reel()).getByRole('button', { name: 'Add the credit' }));
    const form = () => document.querySelector<HTMLElement>('[data-slot=sound-credit-form]')!;
    expect(document.activeElement).toBe(within(form()).getByRole('textbox', { name: 'Title' }));
    await act(async () => fireEvent.click(within(form()).getByRole('button', { name: 'Save the credit' })));
    expect(within(form()).getByRole('alert').textContent).toBe(
      'Give the sound’s title, who made it, or both.',
    );
    fireEvent.change(within(form()).getByRole('textbox', { name: 'Title' }), {
      target: { value: ' Monsoon ' },
    });
    const link = within(form()).getByRole('textbox', { name: 'Link to the sound (optional)' });
    fireEvent.change(link, { target: { value: 'http://example.com/sound' } });
    await act(async () => fireEvent.click(within(form()).getByRole('button', { name: 'Save the credit' })));
    expect(link.getAttribute('aria-invalid')).toBe('true');
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.change(link, { target: { value: 'https://example.com/sound' } });
    await act(async () => fireEvent.click(within(form()).getByRole('button', { name: 'Save the credit' })));
    expect(dispatch).toHaveBeenLastCalledWith('template.setSoundCredit', {
      ...at(template),
      credit: { title: 'Monsoon', url: 'https://example.com/sound' },
    });
    expect(said()).toBe('Sound credit added');
  });
});
