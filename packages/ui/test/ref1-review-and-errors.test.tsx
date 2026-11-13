// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// REF1's follow-ups in the kit. The review page's music, turned off, shows the add-the-sound steps for the chosen
// app, as the export dialog does. An error whose sentence depends on what is missing reads the keyed words. An old
// chat's stop on the dropped download warning reads true, with no fix, because the fix is retired.
import { i18n } from '@lingui/core';
import type { ExportOptions, PlatformSoundSteps, TaalcutError } from '@taalcut/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCard, errorMessage, ExportReview, fixOn, MAKE_FIXTURE_IDS, MAKE_FIXTURES } from '../src/index';
import { RATE, TEMPLATE, makeTimeline, ok, timelineData, wrap } from './make-fixture';

const { project: PROJECT, timeline: TIMELINE } = MAKE_FIXTURE_IDS;
const LINK = 'https://www.instagram.com/reel/EXAMPLE123/';
const STEPS: PlatformSoundSteps = {
  referenceUrl: LINK,
  soundLabel: 'Example Song · Example Artist',
  steps: (['reels', 'shorts', 'tiktok'] as const).map((platform) => ({
    platform,
    stepKeys: [1, 2, 3, 4].map((n) => `music.platformSound.steps.${platform}.${n}`),
  })),
};

const REEL_MUSIC = { path: 'referenceAudio', templateId: TEMPLATE, gainDb: 0 } as const;

const options = (): ExportOptions => ({
  projectId: PROJECT,
  timelineId: TIMELINE,
  timelineRevision: 3,
  rate: RATE,
  durationFrames: 135,
  presets: [],
  defaultPresetId: 'reels',
  music: {
    current: REEL_MUSIC,
    referenceAudioAvailable: true,
    referenceAudioAcknowledged: true,
    platformSound: STEPS,
  },
  captions: { available: true, enabled: true, language: 'en' },
});

describe('the review page’s music, off (REF1)', () => {
  it('shows the reel’s link and sound and the chosen app’s steps; another app shows its own', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    const card = MAKE_FIXTURES.exportApproval.pending;
    const data = timelineData(
      { ...makeTimeline(), music: REEL_MUSIC },
      {
        exportOptions: () => Promise.resolve(options()),
      },
    );
    wrap(<ExportReview card={card} onBack={vi.fn()} />, { decide: vi.fn(), dispatch }, data);
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    const music = await screen.findByRole('switch', { name: 'Music in the video' });
    await waitFor(() => expect(music.getAttribute('aria-checked')).toBe('true'));

    fireEvent.click(music);
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('music.choosePath', {
        projectId: PROJECT,
        timelineId: TIMELINE,
        choice: { path: 'platformSound' },
      }),
    );
    const steps = await screen.findByRole('region', { name: 'Add the sound in the app' });
    expect(within(steps).getByText('instagram.com/reel/EXAMPLE123').getAttribute('title')).toBe(LINK);
    expect(within(steps).getByText('Example Song · Example Artist')).toBeTruthy();
    expect(within(steps).getByText('In Instagram Reels')).toBeTruthy();
    expect(within(steps).getAllByRole('listitem')).toHaveLength(4);

    fireEvent.click(screen.getByRole('radio', { name: 'TikTok' }));
    await waitFor(() => expect(within(steps).getByText('In TikTok')).toBeTruthy());
  });
});

describe('errors keyed by what is missing (REF1)', () => {
  afterEach(() => i18n.activate('en'));
  const missing = (name?: string): TaalcutError => ({
    code: 'render.media_missing',
    messageKey: 'errors.render.media_missing',
    retryable: false,
    ...(name === undefined ? {} : { params: { name } }),
  });

  it('reads the words for the missing thing when the catalogue has them, else the plain sentence', () => {
    i18n.loadAndActivate({
      locale: 'en-ref1-test',
      messages: {
        'errors.render.media_missing': 'A clip is missing.',
        'errors.render.media_missing.reference_audio': 'The reel’s music is gone.',
      },
    });
    expect(errorMessage(i18n, missing('reference audio'))).toBe('The reel’s music is gone.');
    expect(errorMessage(i18n, missing('01K7C5M6Q8R9S0T1V2W3X4Y5ZB'))).toBe('A clip is missing.');
    expect(errorMessage(i18n, missing('music track'))).toBe('A clip is missing.');
    expect(errorMessage(i18n, missing())).toBe('A clip is missing.');
  });
});

describe('an old chat stopped by the dropped download warning (REF1)', () => {
  const stopped: TaalcutError = {
    code: 'templates.acknowledgement_required',
    messageKey: 'errors.templates.acknowledgement_required',
    retryable: false,
    fix: { command: 'reference.showWarning', labelKey: 'fix.showReferenceWarning' },
  };

  it('says what is true now, with no fix to press', () => {
    const onFix = vi.fn();
    wrap(<ErrorCard error={stopped} onFix={onFix} />, {});
    // The first sentence is the card's title, the rest its body.
    expect(screen.getByText('This reel stopped at a step Taalcut no longer asks for.')).toBeTruthy();
    expect(screen.getByText('Send the link again.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(fixOn(stopped.fix, 'mac')).toBeUndefined();
    expect(fixOn({ command: 'sources.choose', labelKey: 'fix.chooseFolder' }, 'mac')).toBeDefined();
  });
});
