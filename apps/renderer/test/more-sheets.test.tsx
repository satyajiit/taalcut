// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { EDITOR_COMMANDS, err, NEUTRAL_GRADE, type Clip, type TaalcutError } from '@taalcut/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoreGallery } from '../src/features/timeline/more/more-gallery';
import { card, moreFixture, mountGallery, tile } from './more-support';

const REFUSED = {
  code: 'timeline.clip_too_short',
  message: 'refused',
  retriable: false,
} as unknown as TaalcutError;

describe('the speed sheet', () => {
  it('sends the same speed command the old picker sent, one card one edit', async () => {
    const f = moreFixture();
    mountGallery(f);
    fireEvent.click(tile('speed'));
    expect(screen.getByRole('radiogroup', { name: 'Speed' })).toBeTruthy();
    expect(card('clip-speed', '1').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(card('clip-speed', '0.5'));
    expect(f.command).toHaveBeenLastCalledWith(EDITOR_COMMANDS.setSpeed, {
      clipId: f.clip!.item.id,
      speed: { kind: 'constant', speed: 0.5 },
    });
    // The card just picked says it is on its way.
    await waitFor(() =>
      expect(card('clip-speed', '0.5').querySelector('[data-slot=choice-mark]')).not.toBeNull(),
    );
  });

  it('goes back to normal speed with the command for normal, not a speed of one', () => {
    const rate = { num: 30, den: 1 };
    const f = moreFixture({
      patch: (clip): Clip => ({
        ...clip,
        speed: {
          curve: 'hold',
          points: [
            { at: { value: 0, rate }, speed: 2 },
            { at: { value: 30, rate }, speed: 2 },
          ],
        },
      }),
    });
    mountGallery(f);
    fireEvent.click(tile('speed'));
    expect(card('clip-speed', '2').getAttribute('aria-checked')).toBe('true');
    // The card in use sends nothing.
    fireEvent.click(card('clip-speed', '2'));
    expect(f.command).not.toHaveBeenCalled();
    fireEvent.click(card('clip-speed', '1'));
    expect(f.command).toHaveBeenLastCalledWith(EDITOR_COMMANDS.setSpeed, {
      clipId: f.clip!.item.id,
      speed: { kind: 'normal' },
    });
  });

  it('walks the cards with the arrows without sending, and sends on Return', () => {
    const f = moreFixture();
    mountGallery(f);
    fireEvent.click(tile('speed'));
    const group = screen.getByRole('radiogroup', { name: 'Speed' });
    // One tab stop: the speed in use.
    expect(group.querySelectorAll('[role=radio][tabindex="0"]')).toHaveLength(1);
    expect(document.activeElement).toBe(card('clip-speed', '1'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(card('clip-speed', '1.5'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(card('clip-speed', '4'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(card('clip-speed', '0.25'));
    expect(f.command).not.toHaveBeenCalled();
    // Return on a button is its click.
    fireEvent.click(document.activeElement!);
    expect(f.command).toHaveBeenCalledTimes(1);
  });

  it('says why beside the cards when the edit is refused, and not a second time under the transport', async () => {
    const f = moreFixture();
    f.command.mockResolvedValueOnce(err(REFUSED));
    mountGallery(f);
    fireEvent.click(tile('speed'));
    await act(async () => {
      fireEvent.click(card('clip-speed', '4'));
    });
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-slot')).toBe('more-refusal');
    expect(alert.textContent).not.toBe('');
    expect(f.edits.clearError).toHaveBeenCalled();
    // The speed in use is still the one marked; nothing spins.
    expect(card('clip-speed', '1').getAttribute('aria-checked')).toBe('true');
    expect(card('clip-speed', '4').querySelector('[data-slot=choice-mark]')).toBeNull();
    // The next pick clears what was said.
    fireEvent.click(card('clip-speed', '2'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('the transition sheet', () => {
  it('sends the same commands the old picker sent: a transition, or its removal for a plain cut', () => {
    const f = moreFixture();
    mountGallery(f);
    fireEvent.click(tile('transition'));
    expect(screen.getByRole('radiogroup', { name: 'Transition' })).toBeTruthy();
    expect(card('clip-transition', 'cut').getAttribute('aria-checked')).toBe('true');
    // Each way in is drawn, not only named.
    for (const kind of ['cut', 'dissolve', 'fade', 'flash', 'whip', 'zoom', 'slide'])
      expect(
        card('clip-transition', kind).querySelector(`[data-slot=transition-motif][data-kind=${kind}]`),
      ).not.toBeNull();
    fireEvent.click(card('clip-transition', 'dissolve'));
    expect(f.command).toHaveBeenLastCalledWith(EDITOR_COMMANDS.setTransition, {
      clipId: f.clip!.item.id,
      edge: 'end',
      kind: 'dissolve',
      direction: null,
    });
  });

  it('removes the transition for a plain cut', () => {
    const f = moreFixture({
      timeline: (timeline) => {
        const video = timeline.tracks[0]!;
        const items = [...video.items];
        // A crossfade after the third scene.
        items.splice(3, 0, {
          type: 'transition',
          id: '01K7C5M6Q8R9S0T1V2W3X4Y5ZT',
          kind: 'dissolve',
          duration: { value: 6, rate: timeline.canvas.rate },
          direction: null,
        } as unknown as (typeof items)[number]);
        return { ...timeline, tracks: [{ ...video, items }, ...timeline.tracks.slice(1)] } as typeof timeline;
      },
    });
    mountGallery(f);
    expect(tile('transition').textContent).toBe('TransitionCrossfade');
    fireEvent.click(tile('transition'));
    expect(card('clip-transition', 'dissolve').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(card('clip-transition', 'cut'));
    expect(f.command).toHaveBeenLastCalledWith(EDITOR_COMMANDS.removeTransition, {
      clipId: f.clip!.item.id,
      edge: 'end',
    });
  });
});

describe('the colour sheet', () => {
  const grade = (f: ReturnType<typeof moreFixture>, patch: unknown) => [
    EDITOR_COMMANDS.setGrade,
    { target: { kind: 'clips', clipIds: [f.clip!.item.id] }, grade: patch },
  ];

  it('sends the same grade commands the old controls sent: a look, an adjustment on release, as shot', () => {
    const f = moreFixture();
    mountGallery(f);
    fireEvent.click(tile('colour'));
    expect(screen.getByRole('radiogroup', { name: 'Colour look' })).toBeTruthy();
    expect(card('clip-look', 'none').getAttribute('aria-checked')).toBe('true');
    // Nothing to undo yet: no reset, no way back.
    expect(document.querySelector('[data-slot=clip-colour-reset]')).toBeNull();
    expect(document.querySelector('[data-slot=clip-colour-clear]')).toBeNull();
    fireEvent.click(card('clip-look', 'mono'));
    expect(f.command).toHaveBeenLastCalledWith(...grade(f, { look: 'mono' }));

    const brightness = screen.getByRole('slider', { name: 'Brightness' });
    // Dragging says the value in words and sends nothing; letting go sends once.
    fireEvent.input(brightness, { target: { value: '0.2' } });
    expect(brightness.getAttribute('aria-valuetext')).toBe('A little brighter');
    expect(f.command).toHaveBeenCalledTimes(1);
    fireEvent.change(brightness, { target: { value: '0.2' } });
    expect(f.command).toHaveBeenLastCalledWith(...grade(f, { exposure: 0.2 }));
    fireEvent.change(screen.getByRole('slider', { name: 'Warmth' }), { target: { value: '-0.6' } });
    expect(f.command).toHaveBeenLastCalledWith(...grade(f, { temperature: -0.6 }));
    fireEvent.change(screen.getByRole('slider', { name: 'Colour strength' }), { target: { value: '0.5' } });
    expect(f.command).toHaveBeenLastCalledWith(...grade(f, { saturation: 0.5 }));
  });

  it('shows each look on the scene’s own frame with the adjustments already made, and both ways back', () => {
    const f = moreFixture({
      patch: (clip): Clip => ({
        ...clip,
        grade: { ...NEUTRAL_GRADE, look: 'warm', exposure: 0.4, temperature: -0.2 },
      }),
    });
    mountGallery(f);
    fireEvent.click(tile('colour'));
    expect(card('clip-look', 'warm').getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-slot=more-sheet-value]')?.textContent).toBe(
      'Warm · Brighter · A little cooler',
    );
    // Nine cards, each a picture of the frame under its look (as shot carries the adjustments alone).
    const pictures = document.querySelectorAll('[data-slot=clip-look] [data-slot=grade-picture]');
    expect(pictures).toHaveLength(9);
    const values = [...pictures].map((picture) =>
      picture.querySelector('feColorMatrix')?.getAttribute('values'),
    );
    expect(new Set(values).size).toBe(9);
    expect(values.every((value) => value?.split(' ').length === 20)).toBe(true);
  });

  it('offers the look’s removal, a reset of the three adjustments, and one way back to as shot', () => {
    const graded = (clip: Clip): Clip => ({
      ...clip,
      grade: { ...NEUTRAL_GRADE, look: 'warm', exposure: 0.4, temperature: -0.2 },
    });
    // Each is one edit; while it is on its way the others wait, so each starts from a sheet at rest.
    const sent = (press: () => void) => {
      const f = moreFixture({ patch: graded });
      const view = mountGallery(f);
      fireEvent.click(tile('colour'));
      press();
      view.unmount();
      return f;
    };
    let f = sent(() => fireEvent.click(card('clip-look', 'none')));
    expect(f.command).toHaveBeenLastCalledWith(...grade(f, { look: null }));
    f = sent(() => fireEvent.click(screen.getByRole('button', { name: 'Reset adjustments' })));
    expect(f.command).toHaveBeenLastCalledWith(...grade(f, { exposure: 0, temperature: 0, saturation: 0 }));
    f = sent(() => fireEvent.click(screen.getByRole('button', { name: 'Back to the colour as shot' })));
    expect(f.command).toHaveBeenLastCalledWith(...grade(f, null));
  });

  it('keeps the sliders working while an edit is on its way, and puts focus on the look in use after a way back', () => {
    const f = moreFixture({
      patch: (clip): Clip => ({ ...clip, grade: { ...NEUTRAL_GRADE, look: 'warm', exposure: 0.4 } }),
    });
    mountGallery(f);
    fireEvent.click(tile('colour'));
    const brightness = screen.getByRole('slider', { name: 'Brightness' }) as HTMLInputElement;
    // A key held down is a run of edits: the slider is never disabled under the hand.
    fireEvent.change(brightness, { target: { value: '0.5' } });
    expect(brightness.disabled).toBe(false);
    fireEvent.change(brightness, { target: { value: '0.6' } });
    expect(f.command).toHaveBeenCalledTimes(2);
    // Reset adjustments will leave the sheet once it has done its work: focus does not go with it.
    const reset = screen.getByRole('button', { name: 'Reset adjustments' });
    reset.focus();
    fireEvent.click(reset);
    expect(document.activeElement).toBe(card('clip-look', 'warm'));
  });

  it('puts a slider back and says why when its edit is refused', async () => {
    const f = moreFixture();
    f.command.mockResolvedValueOnce(err(REFUSED));
    mountGallery(f);
    fireEvent.click(tile('colour'));
    const warmth = screen.getByRole('slider', { name: 'Warmth' }) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(warmth, { target: { value: '0.7' } });
    });
    expect((await screen.findByRole('alert')).getAttribute('data-slot')).toBe('more-refusal');
    await waitFor(() => expect(warmth.value).toBe('0'));
    expect(warmth.getAttribute('aria-valuetext')).toBe('As shot');
  });

  it('reads but does not act once the scene is locked, and says so beside the looks', () => {
    const f = moreFixture();
    const view = mountGallery(f);
    fireEvent.click(tile('colour'));
    const locked = moreFixture({ patch: (clip): Clip => ({ ...clip, locked: true }) });
    view.rerender(<MoreGallery {...locked.props} />);
    expect(screen.getByText('Unlock this scene first')).toBeTruthy();
    fireEvent.click(card('clip-look', 'vivid'));
    expect((screen.getByRole('slider', { name: 'Brightness' }) as HTMLInputElement).disabled).toBe(true);
    expect(locked.command).not.toHaveBeenCalled();
    expect(vi.mocked(f.command)).not.toHaveBeenCalled();
  });
});
