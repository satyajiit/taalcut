// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { Template, TemplateProposals } from '@taalcut/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplateReview, toastStore } from '../src/index';
import { templateFixture } from './template-fixture';

// The kit imports only types from core (dependency-cruiser): a Result by hand.
const ok = <T,>(value: T) => ({ ok: true as const, value });

/** Slot 2's cut is unsure, slot 4 says little, and a line of text in slot 3 may be a sign in the scene. */
function doubted(): Template {
  const base = templateFixture();
  return {
    ...base,
    slots: base.slots.map((slot, i) =>
      i === 1
        ? { ...slot, doubts: [{ reason: 'cutUnsure', confidence: 0.4 }] }
        : i === 3
          ? { ...slot, doubts: [{ reason: 'intentVague' }] }
          : slot,
    ),
    text: [
      ...base.text,
      {
        ...base.text[0]!,
        id: '01K7C5M6Q86000000000000007' as never,
        slotId: base.slots[2]!.id,
        start: base.slots[2]!.start,
        text: 'OPEN',
        doubts: [{ reason: 'textMaybeScene' }],
      },
    ],
  };
}

function review(template: Template, options: { readOnly?: boolean; propose?: () => Promise<unknown> } = {}) {
  // The bus's receipt carries the version the fix made.
  const dispatch = vi.fn(async (_name: string, _payload: unknown) =>
    ok({ result: { templateId: template.id, version: 2 } }),
  );
  const undo = vi.fn(async () => ok(null));
  render(
    <I18nProvider i18n={i18n}>
      <TemplateReview
        variant="page"
        template={template}
        reelUrl={null}
        sheetUrl={null}
        projectId={null}
        readOnly={options.readOnly ?? false}
        dispatch={dispatch}
        undo={undo}
        propose={options.propose as never}
      />
    </I18nProvider>,
  );
  return { dispatch, undo };
}

const at = (template: Template, version = template.version) => ({
  projectId: null,
  templateId: template.id,
  baseVersion: version,
});
const heading = () => screen.getByRole('heading', { level: 3, name: /^Slot \d of 4/ }).textContent;
const count = () => document.querySelector('[data-slot=review-count]')!.textContent;

describe('the review (BRK1-REV)', () => {
  it('opens on the first thing to check and steps through them with J and K', () => {
    review(doubted());
    expect(heading()).toBe('Slot 2 of 4');
    expect(count()).toContain('3 to check');
    expect(screen.getByText('Taalcut isn’t sure this is a cut')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(heading()).toBe('Slot 3 of 4: The pour');
    expect(screen.getByText('This may be part of the scene, not text on top')).toBeTruthy();
    // A screen reader hears where J went.
    expect(document.querySelector('[data-slot=review-current]')!.textContent).toBe(
      'Slot 3: This may be part of the scene, not text on top',
    );
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(heading()).toBe('Slot 4 of 4');
    fireEvent.keyDown(document.body, { key: 'k' });
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(heading()).toBe('Slot 2 of 4');
    // The arrows move between slots, whatever is left to check.
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(heading()).toBe('Slot 1 of 4');
  });

  it('Looks right approves the slot on screen and goes on to the next thing to check', async () => {
    const template = doubted();
    const { dispatch } = review(template);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Slot 2 looks right' })));
    expect(dispatch).toHaveBeenLastCalledWith('template.slot.approve', {
      ...at(template),
      slotIds: [template.slots[1]!.id],
      approved: true,
    });
    expect(heading()).toBe('Slot 3 of 4: The pour');
    // Scene text has its own answers: It's text keeps it (on the head that approval made) and goes on.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'It’s text' })));
    expect(dispatch).toHaveBeenLastCalledWith('template.doubt.dismiss', {
      ...at(template, 2),
      target: { kind: 'text', overlayId: template.text[1]!.id },
      reason: 'textMaybeScene',
    });
    expect(heading()).toBe('Slot 4 of 4');
  });

  it('a slot picked on the strip is what Looks right approves, whatever was current before', async () => {
    const template = doubted();
    const { dispatch } = review(template);
    // Slot 2's unsure cut is current; the person picks slot 1 with the arrow and says it looks right.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(heading()).toBe('Slot 4 of 4');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Slot 4 looks right' })));
    expect(dispatch).toHaveBeenLastCalledWith('template.slot.approve', {
      ...at(template),
      slotIds: [template.slots[3]!.id],
      approved: true,
    });
  });

  it('Not text removes a line OCR took from the scene, with Undo in its toast', async () => {
    const template = doubted();
    const { dispatch, undo } = review(template);
    fireEvent.keyDown(document.body, { key: 'j' });
    const before = toastStore.list().length;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Not text' })));
    expect(dispatch).toHaveBeenLastCalledWith('template.text.remove', {
      ...at(template),
      overlayIds: [template.text[1]!.id],
    });
    const shown = toastStore.list().slice(before);
    expect(shown.map((entry) => entry.title)).toEqual(['Text removed']);
    act(() => shown[0]!.action?.onSelect());
    expect(undo).toHaveBeenCalledOnce();
  });

  it('moves a cut from the keyboard: a beat with Shift, a live time, Enter keeps it', async () => {
    const template = doubted();
    const { dispatch } = review(template);
    const cut = screen.getByRole('slider', { name: 'Cut before slot 2' });
    expect(screen.getAllByRole('slider')).toHaveLength(1);
    fireEvent.keyDown(cut, { key: 'ArrowRight', shiftKey: true });
    expect(cut.getAttribute('aria-valuetext')).toBe('1.50s, on beat 4');
    expect(dispatch).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(cut, { key: 'Enter' }));
    expect(dispatch).toHaveBeenLastCalledWith('template.slot.moveCut', {
      ...at(template),
      slotId: template.slots[1]!.id,
      to: { value: 45, rate: { num: 30, den: 1 } },
      snap: 'beat',
    });
    // Escape puts a nudged cut back without a command.
    dispatch.mockClear();
    fireEvent.keyDown(cut, { key: 'ArrowLeft' });
    fireEvent.keyDown(cut, { key: 'Escape' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Tell Taalcut shows proposals as a diff; Accept dispatches one, nothing applies before', async () => {
    const template = doubted();
    const answer: TemplateProposals = {
      baseVersion: 1,
      proposals: [
        {
          id: 'p1',
          command: 'template.slot.editIntent',
          payload: {
            slotId: template.slots[3]!.id,
            intent: { text: 'A sip, then a slow smile, held still' },
          },
          why: 'Says what is in the frame.',
        },
        {
          id: 'p2',
          command: 'template.slot.setRole',
          payload: { slotId: template.slots[3]!.id, role: 'outro' },
          why: 'It ends the reel.',
        },
      ] as TemplateProposals['proposals'],
      dropped: 0,
      note: null,
      model: { provider: 'Ollama', model: 'gemma3:4b', local: true },
    };
    const propose = vi.fn(async () => ok(answer));
    const { dispatch } = review(template, { propose });
    fireEvent.click(screen.getByRole('button', { name: 'Tell Taalcut' }));
    const tell = document.querySelector<HTMLElement>('[data-slot=tell-taalcut]')!;
    fireEvent.change(within(tell).getByRole('textbox'), { target: { value: 'Slot 4 says too little' } });
    await act(async () => fireEvent.click(within(tell).getByRole('button', { name: 'Ask for changes' })));
    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: template.id, baseVersion: 1, message: 'Slot 4 says too little' }),
    );
    await screen.findByText('Slot 4’s description');
    expect(within(tell).getByText('A sip, then a slow smile, held still')).toBeTruthy();
    expect(within(tell).getByText('Answered by gemma3:4b, which runs here: nothing was sent.')).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
    const first = tell.querySelector<HTMLElement>('[data-slot=proposal]')!;
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: 'Accept' })));
    expect(dispatch).toHaveBeenLastCalledWith('template.slot.editIntent', {
      slotId: template.slots[3]!.id,
      intent: { text: 'A sip, then a slow smile, held still' },
      ...at(template),
    });
    await waitFor(() => expect(first.getAttribute('data-state')).toBe('accepted'));
  });

  it('names a line’s look in the reel, and says a doubted line stays out of videos until answered', () => {
    const template = doubted();
    const designed: Template = {
      ...template,
      text: template.text.map((item, i) =>
        i === 1
          ? {
              ...item,
              design: {
                kind: 'chatBubble',
                colors: { fill: '#ffffff', text: '#111111', stroke: null },
                cornerRadius: 0.4,
                tail: 'left',
                font: { class: 'sans', weight: 500 },
                motion: { enter: 'pop', exit: 'fade', typing: false },
                confidence: 0.8,
              },
            }
          : item,
      ),
    };
    review(designed);
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(document.querySelector('[data-slot=overlay-design]')!.textContent).toBe('AaChat bubble');
    expect(screen.getByText('Videos made from this template leave it out until you answer.')).toBeTruthy();
  });

  it('keeps an older version read-only: it steps and plays, nothing edits', () => {
    const { dispatch } = review(doubted(), { readOnly: true });
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(heading()).toBe('Slot 3 of 4: The pour');
    expect(screen.queryByRole('button', { name: /looks right$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not text' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Fix puts an approved slot back among the ones to check', async () => {
    const template = doubted();
    const { dispatch } = review(template);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(heading()).toBe('Slot 1 of 4');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Fix' }), { button: 0, pointerType: 'mouse' });
    await act(async () =>
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Check slot 1 again' })),
    );
    expect(dispatch).toHaveBeenLastCalledWith('template.slot.approve', {
      ...at(template),
      slotIds: [template.slots[0]!.id],
      approved: false,
    });
  });

  it('Fix › Move the cut hands focus to the cut, so the arrows move it', async () => {
    review(doubted());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Fix' }), { button: 0, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move the cut before slot 2' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('slider', { name: 'Cut before slot 2' })),
    );
  });

  it('with nothing left to check, offers to approve the rest, never before', async () => {
    const template = templateFixture();
    const { dispatch } = review(template);
    expect(count()).toContain('Nothing left to check');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve the rest (3)' })));
    expect(dispatch).toHaveBeenLastCalledWith('template.slot.approve', {
      ...at(template),
      slotIds: template.slots.slice(1).map((slot) => slot.id),
      approved: true,
    });
  });
});
