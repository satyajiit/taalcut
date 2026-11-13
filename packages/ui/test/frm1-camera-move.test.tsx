// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CameraMotionMeasure, Template } from '@taalcut/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplateReview } from '../src/index';
import { motionAuthor } from '../src/templates/camera-move';
import { checkItems, checkSummary } from '../src/templates/review-checks';
import { reviewEditCommand } from '../src/templates/use-review-edits';
import { templateFixture } from './template-fixture';

// FRM1-MOT: the review's camera-move picker, and the doubt it answers.

const ok = <T,>(value: T) => ({ ok: true as const, value });
const measure = (label: CameraMotionMeasure['label'], confidence: number): CameraMotionMeasure => ({
  panX: 0.05,
  panY: 0,
  scale: 0,
  rotation: 0,
  jitter: 0.001,
  label,
  confidence,
  version: 1,
});

/** Slot 2's camera was measured as a pan, not surely, so its motion is unknown and the review asks. */
function unsure(): Template {
  const base = templateFixture();
  return {
    ...base,
    slots: base.slots.map((slot, i) =>
      i === 1
        ? {
            ...slot,
            intent: { ...slot.intent, motion: null },
            motionMeasure: measure('pan', 0.4),
            doubts: [{ reason: 'motionUnsure', confidence: 0.6 }],
          }
        : slot,
    ),
  };
}

function view(template: Template) {
  const dispatch = vi.fn(async (_name: string, _payload: unknown) =>
    ok({ result: { templateId: template.id, version: template.version + 1 } }),
  );
  render(
    <I18nProvider i18n={i18n}>
      <TemplateReview
        variant="sheet"
        template={template}
        reelUrl={null}
        sheetUrl={null}
        projectId={null}
        dispatch={dispatch}
        undo={async () => ok(null)}
      />
    </I18nProvider>,
  );
  return dispatch;
}

const open = (button: HTMLElement) => fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });
const said = () => document.querySelector('[data-slot=review-said]')?.textContent;
const at = (template: Template) => ({
  projectId: null,
  templateId: template.id,
  baseVersion: template.version,
});

describe('the camera-move picker (FRM1-MOT)', () => {
  it('asks how the camera moves in its own words, and a pick answers it', async () => {
    const template = unsure();
    const dispatch = view(template);
    expect(screen.getByText('Taalcut isn’t sure how the camera moves')).toBeTruthy();
    open(screen.getByRole('button', { name: 'Pick the camera move' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Taalcut measured Pan, but isn’t sure')).toBeTruthy();
    // Seven moves, each with what it means, and "I don't know" (checked: the motion is unknown).
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items).toHaveLength(8);
    expect(items.at(-1)!.getAttribute('aria-checked')).toBe('true');
    await act(async () => fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Tracking/ })));
    expect(dispatch).toHaveBeenLastCalledWith('template.setMotion', {
      ...at(template),
      slotId: template.slots[1]!.id,
      motion: 'tracking',
    });
    expect(said()).toBe('Slot 2’s camera move is now Tracking');
  });

  it('Leave it unknown keeps the motion unknown and answers the doubt', async () => {
    const template = unsure();
    const dispatch = view(template);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Leave it unknown' })));
    expect(dispatch).toHaveBeenLastCalledWith('template.doubt.dismiss', {
      ...at(template),
      target: { kind: 'slot', slotId: template.slots[1]!.id },
      reason: 'motionUnsure',
    });
  });

  it('shows the move beside the description, Taalcut’s or yours, and changes it from there', async () => {
    const base = templateFixture();
    const template: Template = {
      ...base,
      slots: base.slots.map((slot) => ({ ...slot, motionMeasure: measure(slot.intent.motion, 0.9) })),
    };
    const dispatch = view(template);
    const trigger = screen.getByRole('button', { name: 'Camera move in slot 1: Still camera. Change it' });
    open(trigger);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Taalcut measured Still camera from the reel')).toBeTruthy();
    await act(async () => fireEvent.click(within(menu).getByRole('menuitemradio', { name: /I don’t know/ })));
    expect(dispatch).toHaveBeenLastCalledWith(
      'template.setMotion',
      expect.objectContaining({ slotId: template.slots[0]!.id, motion: null }),
    );
    expect(said()).toBe('Slot 1’s camera move left unknown');
  });
});

describe('camera-move words and commands', () => {
  it('counts unsure camera moves as their own kind in the summary', () => {
    const template = unsure();
    expect(checkSummary(i18n, checkItems(template))).toBe('1 camera move Taalcut isn’t sure of');
  });

  it('names whose the move is: the measure’s, or the person’s when they picked another', () => {
    const slot = templateFixture().slots[1]!;
    expect(motionAuthor({ ...slot, motionMeasure: measure('pan', 0.9) })).toBe('ai');
    expect(motionAuthor({ ...slot, motionMeasure: measure('tilt', 0.9) })).toBe('you');
    expect(motionAuthor(slot)).toBe(slot.intent.source === 'user' ? 'you' : 'ai');
  });

  it('makes template.setMotion on the version on screen', () => {
    const template = unsure();
    const slotId = template.slots[1]!.id;
    expect(reviewEditCommand(template, null, { kind: 'setMotion', slotId, motion: 'pan' }, 4)).toEqual({
      name: 'template.setMotion',
      payload: { projectId: null, templateId: template.id, baseVersion: 4, slotId, motion: 'pan' },
    });
  });
});
