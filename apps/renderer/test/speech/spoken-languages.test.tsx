// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-LANG in the window: Settings › General's languages you speak (the default said, a language added and taken
// out, the Indian-language identifier's row once one needs it, its download started from here), and the clip
// page's language row (Hindi and English; unclear; Odia, with the honest line where its transcript would be; a
// language set by hand, with Set by you, and given back).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KIND } from '../../src/backend/fake/library/assets';
import {
  BRIEF_SPEECH_CLIP,
  RECHECK_SPEECH_CLIP,
  MIXED_SPEECH_CLIP,
  ODIA_SPEECH_CLIP,
  UNCLEAR_SPEECH_CLIP,
} from '../../src/backend/fake/library/language-clips';
import { fakeUlid } from '../../src/backend/fake/library/seed';
import { renderApp } from '../render-app';

const languageList = () => screen.findByRole('list', { name: 'Languages you speak' });
const clip = (n: number) => `/library/${fakeUlid<'Asset'>(KIND.asset, n)}`;

describe('Settings › General › Languages you speak', () => {
  it('says the default, adds Odia with the identifier’s download, and takes it out again', async () => {
    const { controls } = await renderApp('/settings/general', {
      phase2b: { onboarding: { downloadTickMs: 0 } },
    });
    const list = await languageList();
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.dataset['language']),
    ).toEqual(['en']);
    expect(screen.getByText('Until you choose, these are Taalcut’s language and English.')).toBeTruthy();
    // One language left: nothing to remove.
    expect(within(list).queryByRole('button', { name: /Remove/ })).toBeNull();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Add a language'), { target: { value: 'or' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('listitem')
          .map((row) => row.dataset['language']),
      ).toEqual(['en', 'or']),
    );
    expect(controls.speech.languages()).toEqual(['en', 'or']);
    // The identifier comes with it, named for why, and the download fetched it first.
    const identifier = await screen.findByText('Language identifier for Odia and other Indian languages');
    expect(identifier.closest('[data-slot=spoken-identifier]')).toBeTruthy();
    await waitFor(() =>
      expect(controls.dispatched.map((each) => each.name)).toContain('components.download'),
    );
    await waitFor(() => expect(screen.getByText(/On this Mac/)).toBeTruthy());

    await act(async () => {
      fireEvent.click(within(list).getByRole('button', { name: 'Remove Odia' }));
    });
    await waitFor(() => expect(controls.speech.languages()).toEqual(['en']));
    // Not needed now: its row goes, and it stays on this Mac (Settings › Models lists it).
    await waitFor(() =>
      expect(screen.queryByText('Language identifier for Odia and other Indian languages')).toBeNull(),
    );
    const listed = controls.onboarding.components().find((each) => each.id === 'anuvani-lid');
    expect(listed?.status).toBe('installed');
  });
});

describe('the clip page’s spoken language', () => {
  it('says Hindi and English, with the AI mark', async () => {
    await renderApp(clip(MIXED_SPEECH_CLIP));
    const row = await screen.findByText('Hindi and English speech');
    expect(row.closest('[data-slot=clip-language]')?.getAttribute('data-state')).toBe('mixed');
    expect(screen.getByLabelText('Heard by Taalcut')).toBeTruthy();
  });

  it('says it couldn’t tell, rather than guess', async () => {
    await renderApp(clip(UNCLEAR_SPEECH_CLIP));
    expect(await screen.findByText('Speech, language unclear')).toBeTruthy();
  });

  it('says Odia, and where its transcript would be, that Taalcut can’t write it out yet', async () => {
    await renderApp(clip(ODIA_SPEECH_CLIP));
    expect(await screen.findByText('Odia speech')).toBeTruthy();
    expect(await screen.findByText('Taalcut can’t write out Odia speech yet.')).toBeTruthy();
  });

  it('heard speech with nothing written down names no language, and doesn’t say no one speaks', async () => {
    await renderApp(clip(BRIEF_SPEECH_CLIP));
    expect(await screen.findByText('Speech, language unclear')).toBeTruthy();
    expect(
      await screen.findByText('Taalcut heard a little speech, too short or unclear to write down.'),
    ).toBeTruthy();
    expect(screen.queryByText('No one speaks in this clip.')).toBeNull();
    // The heading names no language over a transcript with no words.
    expect(screen.getByRole('heading', { name: /What’s said/ }).textContent).toBe('What’s said');
  });

  it('heard before LIB1 and being decided again: speech, checking the language, and no old guess', async () => {
    await renderApp(clip(RECHECK_SPEECH_CLIP));
    const row = await screen.findByText('Speech, checking the language');
    const fact = row.closest('[data-slot=clip-language]');
    expect(fact?.getAttribute('data-state')).toBe('checking');
    // Not heard at this version, so no AI mark; Change still sets it by hand.
    expect(screen.queryByLabelText('Heard by Taalcut')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change the language' })).toBeTruthy();
    // Its old words stay, with no language named over them.
    expect(screen.getByRole('heading', { name: /What’s said/ }).textContent).toBe('What’s said');
  });

  it('takes a language set by hand, marks it Set by you, and gives it back', async () => {
    const { controls } = await renderApp(clip(UNCLEAR_SPEECH_CLIP));
    await screen.findByText('Speech, language unclear');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change the language' }));
    });
    const picker = await screen.findByLabelText('Language spoken in this clip', { selector: 'select' });
    await act(async () => {
      fireEvent.change(picker, { target: { value: 'vi' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Vietnamese' }));
    });
    expect(await screen.findByText('Vietnamese speech')).toBeTruthy();
    expect(screen.getByText('Set by you')).toBeTruthy();
    expect(controls.dispatched.map((each) => each.name)).toContain('library.setAssetLanguage');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change the language' }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Use what Taalcut heard' }));
    });
    expect(await screen.findByText('Speech, language unclear')).toBeTruthy();
    expect(screen.queryByText('Set by you')).toBeNull();
  });
});
