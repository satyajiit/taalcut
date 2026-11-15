// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  newId,
  ok,
  RationalTime,
  SIMPLE_EDITOR_COMMANDS as N,
  type Clip,
  type TaalcutError,
} from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { card, moreFixture, mountGallery, tile } from './more-support';

const REFUSED = {
  code: 'timeline.invalid_move',
  message: 'refused',
  retriable: false,
} as unknown as TaalcutError;

describe('Make another size', () => {
  it('makes an independent size copy and opens only the committed copy from its receipt', async () => {
    const f = moreFixture();
    const newTimelineId = newId<'Timeline'>();
    f.command.mockResolvedValueOnce(
      ok({
        id: newId<'Command'>(),
        name: N.makeSize,
        projectId: f.timeline.projectId,
        result: { timelineId: newTimelineId, revision: 1, affectedItemIds: [] },
        deduplicated: false,
        sequence: 3,
        undoable: true,
      }),
    );
    mountGallery(f);
    fireEvent.click(tile('size'));
    const dialog = screen.getByRole('dialog', { name: 'Make another size' });
    expect(
      within(dialog).getByText('Creates an independent video copy. Your original stays as it is.'),
    ).toBeTruthy();
    // The four sizes, drawn to their shapes, with where each is posted; the one the video has is marked, and the
    // first other one is the one offered.
    expect(within(dialog).getAllByRole('radio')).toHaveLength(4);
    for (const aspect of ['9:16', '4:5', '1:1', '16:9'])
      expect(
        card('size-choices', aspect).querySelector(`[data-slot=size-shape][data-aspect="${aspect}"]`),
      ).not.toBeNull();
    expect(card('size-choices', '9:16').textContent).toContain('Now');
    expect(card('size-choices', '16:9').textContent).toContain('YouTube and wide screens');
    expect(card('size-choices', '4:5').getAttribute('aria-checked')).toBe('true');
    // Choosing a size sends nothing: the primary does.
    fireEvent.click(card('size-choices', '1:1'));
    expect(f.command).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make the 1:1 copy' }));
    });
    expect(f.command).toHaveBeenCalledWith(N.makeSize, { aspect: '1:1' });
    expect(f.props.onVideo).not.toHaveBeenCalled();
    // The follow-through is in the same dialog.
    expect(await screen.findByRole('dialog', { name: 'The 1:1 copy is ready' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the new video' }));
    expect(f.props.onVideo).toHaveBeenCalledWith(newTimelineId);
    expect(f.timeline.id).not.toBe(newTimelineId);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says why in the dialog when the copy is refused, and stays open to try again', async () => {
    const f = moreFixture();
    f.command.mockResolvedValueOnce(err(REFUSED));
    mountGallery(f);
    fireEvent.click(tile('size'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make the 4:5 copy' }));
    });
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-slot')).toBe('more-refusal');
    expect(f.edits.clearError).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Make another size' })).toBeTruthy();
    expect(f.props.onVideo).not.toHaveBeenCalled();
  });
});

describe('Freeze this moment', () => {
  it('freezes the frame under the playhead for two seconds by default, with one confirm', async () => {
    const f = moreFixture({ scene: 0 });
    f.playhead.seek(14);
    mountGallery(f);
    fireEvent.click(tile('freeze'));
    // The moment is the frame on show: playing stops there while the dialog asks how long.
    expect(f.pause).toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Freeze this moment' });
    expect(dialog.querySelector('[data-slot=freeze-frame]')).not.toBeNull();
    const length = within(dialog).getByRole('spinbutton', {
      name: 'Hold length (seconds)',
    }) as HTMLInputElement;
    expect(length.value).toBe('2');
    // The playhead moving behind the dialog does not move the moment.
    f.playhead.seek(30);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Freeze this moment' }));
    });
    expect(f.command).toHaveBeenLastCalledWith(N.freezeFrame, {
      clipId: f.clip!.item.id,
      at: RationalTime.of(14, f.model.rate),
      duration: RationalTime.fromSeconds(2, f.model.rate),
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('steps the hold by half a second and takes a typed length', async () => {
    const f = moreFixture({ scene: 0 });
    f.playhead.seek(14);
    mountGallery(f);
    fireEvent.click(tile('freeze'));
    const length = screen.getByRole('spinbutton', { name: 'Hold length (seconds)' }) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Half a second longer' }));
    expect(length.value).toBe('2.5');
    fireEvent.click(screen.getByRole('button', { name: 'Half a second shorter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Half a second shorter' }));
    expect(length.value).toBe('1.5');
    fireEvent.change(length, { target: { value: '3.5' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Freeze this moment' }));
    });
    expect(f.command).toHaveBeenLastCalledWith(N.freezeFrame, {
      clipId: f.clip!.item.id,
      at: RationalTime.of(14, f.model.rate),
      duration: RationalTime.fromSeconds(3.5, f.model.rate),
    });
  });

  it('changes an existing hold’s length without capturing the frame again', async () => {
    const f = moreFixture({
      scene: 0,
      patch: (clip): Clip => ({ ...clip, holdFrame: RationalTime.of(19, { num: 30, den: 1 }) }),
    });
    // Wherever the playhead is: the held frame is the scene's own.
    f.playhead.seek(120);
    mountGallery(f);
    fireEvent.click(tile('freeze'));
    const dialog = screen.getByRole('dialog', { name: 'Change hold length' });
    const length = within(dialog).getByRole('spinbutton', {
      name: 'Hold length (seconds)',
    }) as HTMLInputElement;
    // It starts from the length the hold has: the first scene is a second and a half.
    expect(length.value).toBe('1.5');
    fireEvent.change(length, { target: { value: '3.5' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Change hold length' }));
    });
    expect(f.command).toHaveBeenLastCalledWith(N.setHoldDuration, {
      clipId: f.clip!.item.id,
      duration: RationalTime.fromSeconds(3.5, f.model.rate),
    });
  });

  it('says why it waits when the playhead is outside the scene or the length is none a hold can have', () => {
    const f = moreFixture({ scene: 0 });
    f.playhead.seek(200);
    mountGallery(f);
    fireEvent.click(tile('freeze'));
    const confirm = screen.getByRole('button', { name: 'Freeze this moment' }) as HTMLButtonElement;
    const note = document.querySelector('[data-slot=freeze-note]')!;
    expect(note.textContent).toBe(
      'The playhead is outside scene 1. Close this and move it to the moment you want.',
    );
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute('aria-describedby')).toBe(note.id);
    fireEvent.click(confirm);
    expect(f.command).not.toHaveBeenCalled();
  });

  it('refuses a length no hold can have, in words', () => {
    const f = moreFixture({ scene: 0 });
    f.playhead.seek(14);
    mountGallery(f);
    fireEvent.click(tile('freeze'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Hold length (seconds)' }), {
      target: { value: '0' },
    });
    expect(document.querySelector('[data-slot=freeze-note]')?.textContent).toBe(
      'A hold lasts from one frame to 60 seconds.',
    );
    expect((screen.getByRole('button', { name: 'Freeze this moment' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('keeps the dialog open and says why when the freeze is refused', async () => {
    const f = moreFixture({ scene: 0 });
    f.playhead.seek(14);
    f.command.mockResolvedValueOnce(err(REFUSED));
    mountGallery(f);
    fireEvent.click(tile('freeze'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Freeze this moment' }));
    });
    expect((await screen.findByRole('alert')).getAttribute('data-slot')).toBe('more-refusal');
    expect(screen.getByRole('dialog', { name: 'Freeze this moment' })).toBeTruthy();
    expect(f.edits.clearError).toHaveBeenCalled();
  });
});

describe('Why this shot', () => {
  it('says who picked the shot and how sure it was, with the shot’s name', () => {
    const f = moreFixture();
    mountGallery(f);
    expect(tile('why').getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(tile('why'));
    const dialog = screen.getByRole('dialog', { name: 'Why this shot' });
    const facts = dialog.querySelector('[data-slot=clip-pick]')!;
    expect(within(dialog).getByText('Scene 3')).toBeTruthy();
    expect(facts.textContent).toContain('Who picked it');
    expect(facts.textContent).toContain('Taalcut picked this');
    expect(facts.textContent).toContain('The shot');
    // No disclosure to open: it is all there.
    expect(dialog.querySelector('details')).toBeNull();
    // Reading changes nothing.
    expect(f.command).not.toHaveBeenCalled();
  });

  it('says so when you changed the shot yourself, or when nobody is on record', () => {
    const noted = (note: 'userPick' | null) =>
      moreFixture({
        timeline: (timeline) => {
          const clipId = (timeline.tracks[0]!.items[2] as Clip).id;
          return {
            ...timeline,
            cast: note
              ? timeline.cast && {
                  ...timeline.cast,
                  slots: timeline.cast.slots.map((slot) =>
                    slot.clipId === clipId ? { ...slot, note } : slot,
                  ),
                }
              : null,
          } as typeof timeline;
        },
      });
    const yours = noted('userPick');
    expect(yours.clip!.chosenBy).toBe('you');
    const view = mountGallery(yours);
    expect(tile('why').textContent).toBe('Why this shotYou changed this');
    expect(tile('why').querySelector('[data-slot=more-chip]')?.getAttribute('data-family')).toBe('you');
    fireEvent.click(tile('why'));
    expect(screen.getByRole('dialog', { name: 'Why this shot' }).textContent).toContain('You changed this');
    view.unmount();

    const nobody = noted(null);
    expect(nobody.clip!.chosenBy).toBeNull();
    mountGallery(nobody);
    expect(tile('why').textContent).toBe('Why this shotAbout the shot this scene plays');
    fireEvent.click(tile('why'));
    expect(screen.getByRole('dialog', { name: 'Why this shot' }).textContent).toContain(
      'There is no record of who picked this shot.',
    );
  });
});
