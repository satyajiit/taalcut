// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { CardOf, Result } from '@taalcut/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_FIXTURES,
  CardView,
  type CardActions,
  type CardVoiceCapture,
  type CardVoiceRecording,
  type MediaCardActions,
  type MicrophonePermission,
} from '../src/index';
import { failed, ok, wrap } from './make-fixture';

const fixture = (status: string): CardOf<'voiceConsent'> => {
  const card = CARD_FIXTURES.voiceConsent[status];
  if (!card) throw new Error(`no voiceConsent fixture ${status}`);
  return card;
};
const CONSENT = fixture('ready').consentId;

/** A microphone whose recording the test drives: its level feed, and what stop answers. */
function microphone(permission: MicrophonePermission = 'granted') {
  let level: ((value: number) => void) | null = null;
  const recording = {
    stop: vi.fn<CardVoiceRecording['stop']>(() =>
      Promise.resolve({ ok: true, value: { captureKey: '01K7C5M6Q8R9S0T1V2W3X4CAP1', durationMs: 61_000 } }),
    ),
    cancel: vi.fn<CardVoiceRecording['cancel']>(() => Promise.resolve(ok())),
  };
  const capture: CardVoiceCapture = {
    permission: vi.fn(() => Promise.resolve({ ok: true, value: permission } as Result<MicrophonePermission>)),
    start: vi.fn<CardVoiceCapture['start']>(({ onLevel }) => {
      level = onLevel;
      return Promise.resolve({ ok: true, value: recording });
    }),
  };
  return { capture, recording, level: (value: number) => act(() => level?.(value)) };
}

const actions = (extra: CardActions & MediaCardActions): CardActions => extra;

afterEach(() => vi.useRealTimers());

describe('voice consent card (U-4)', () => {
  it('ready: says what happens, puts the typed name in the consent line, and starts only with a name', () => {
    const mic = microphone();
    wrap(
      <CardView card={fixture('ready')} />,
      actions({ voiceCapture: mic.capture, dispatch: () => Promise.resolve(ok()) }),
    );
    expect(screen.getByText(/Nothing leaves this Mac until you choose Create my voice/)).toBeTruthy();
    expect(screen.getByText('Taalcut asks macOS for the microphone when you start.')).toBeTruthy();
    const start = screen.getByRole('button', { name: 'Start recording' });
    expect(start.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Your name as you’ll say it'), { target: { value: 'Mira' } });
    const line = document.querySelector('[data-slot=consent-line]');
    expect(line?.textContent).toBe(
      'My name is Mira. This is my own voice, and I agree that Taalcut may make a copy of it from this recording for the videos I make.',
    );
    expect(line?.getAttribute('translate')).toBe('no');
    expect(line?.getAttribute('lang')).toBe('en');
    expect(start.hasAttribute('disabled')).toBe(false);
  });

  it('records, waits for a minute, then stops and dispatches voice.recordConsent with the capture key', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mic = microphone();
    const dispatch = vi.fn(() => Promise.resolve(ok({ consentId: CONSENT, phraseMatch: 0.95 })));
    wrap(<CardView card={fixture('ready')} />, actions({ voiceCapture: mic.capture, dispatch }));
    fireEvent.change(screen.getByLabelText('Your name as you’ll say it'), { target: { value: ' Mira ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    expect(await screen.findByText('Recording')).toBeTruthy();
    expect(mic.capture.start).toHaveBeenCalledWith(expect.objectContaining({ consentId: CONSENT }));
    // The meter subscribes in an effect, which the fake timers hold until React flushes.
    await act(async () => undefined);
    mic.level(0.6);
    const fill = document.querySelector<HTMLElement>('[data-slot=level-fill]');
    expect(fill?.style.getPropertyValue('--level')).toBe('0.6');
    const stop = screen.getByRole('button', { name: 'Stop and check' });
    expect(stop.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Keep reading. Stop works after a minute.')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(stop.hasAttribute('disabled')).toBe(false);
    fireEvent.click(stop);
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('voice.recordConsent', {
        projectId: null,
        consentId: CONSENT,
        captureKey: '01K7C5M6Q8R9S0T1V2W3X4CAP1',
        speakerName: 'Mira',
        language: 'en',
        termsVersion: '1',
      }),
    );
    expect(await screen.findByText('Consent saved on this Mac.')).toBeTruthy();
  });

  it('shows what the check heard, as written, beside the line on a mismatch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mic = microphone();
    const dispatch = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: {
          code: 'audio.consent_mismatch',
          messageKey: 'errors.audio.consent_mismatch',
          retryable: false,
          params: { heard: '<i>I am Mira</i>' },
        },
      }),
    );
    wrap(<CardView card={fixture('ready')} />, actions({ voiceCapture: mic.capture, dispatch }));
    fireEvent.change(screen.getByLabelText('Your name as you’ll say it'), { target: { value: 'Mira' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await screen.findByText('Recording');
    // The clock's interval starts in an effect after the first paint: let it, then pass the minute.
    await act(async () => undefined);
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    const stop = screen.getByRole('button', { name: 'Stop and check' });
    await waitFor(() => expect(stop.hasAttribute('disabled')).toBe(false));
    fireEvent.click(stop);
    const heard = await screen.findByText('<i>I am Mira</i>');
    expect(heard.closest('[translate=no]')).toBeTruthy();
    expect(screen.getByText(/^My name is Mira\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Record again' }));
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeTruthy();
  });

  it('cancels a recording (main drops the file) and is ready again', async () => {
    const mic = microphone();
    wrap(
      <CardView card={fixture('ready')} />,
      actions({ voiceCapture: mic.capture, dispatch: () => Promise.resolve(ok()) }),
    );
    fireEvent.change(screen.getByLabelText('Your name as you’ll say it'), { target: { value: 'Mira' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel recording' }));
    await waitFor(() => expect(mic.recording.cancel).toHaveBeenCalled());
    expect(await screen.findByText('Ready to record')).toBeTruthy();
  });

  it('says how to turn the microphone on when macOS denies it, and records nothing', async () => {
    const mic = microphone('denied');
    wrap(
      <CardView card={fixture('ready')} />,
      actions({ voiceCapture: mic.capture, dispatch: () => Promise.resolve(ok()) }),
    );
    fireEvent.change(screen.getByLabelText('Your name as you’ll say it'), { target: { value: 'Mira' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    expect(
      await screen.findByText(/Turn it on in System Settings › Privacy & Security › Microphone/),
    ).toBeTruthy();
    expect(mic.capture.start).not.toHaveBeenCalled();
  });

  it('without the microphone in the app, shows the steps but no recording controls', () => {
    wrap(<CardView card={fixture('recording')} />);
    expect(screen.getByText('Microphone level')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop and check' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel recording' })).toBeNull();
  });

  it('checking: says the check runs on this Mac', () => {
    wrap(<CardView card={fixture('checking')} />);
    expect(screen.getByText('Checking it’s you saying the consent line… (on this Mac)')).toBeTruthy();
  });

  it('stored: asks before the recording leaves this Mac, then dispatches voice.createClone', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok({ voiceId: 'v1', requiresVerification: false })));
    wrap(<CardView card={fixture('stored')} />, { dispatch });
    fireEvent.click(screen.getByRole('button', { name: 'Create my voice' }));
    expect(screen.getByText('Send your recording off this Mac?')).toBeTruthy();
    expect(screen.getByText('ElevenLabs').getAttribute('translate')).toBe('no');
    const send = screen.getByRole('button', { name: 'Send and create my voice' });
    expect(send.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Name your voice'), { target: { value: 'Mira’s voice' } });
    fireEvent.click(send);
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('voice.createClone', {
        projectId: null,
        consentId: CONSENT,
        name: 'Mira’s voice',
      }),
    );
    expect(await screen.findByText('Mira’s voice')).toBeTruthy();
    expect(screen.getByText('Voice made')).toBeTruthy();
  });

  it('stored: a refused clone says why and stays saved', async () => {
    wrap(<CardView card={fixture('stored')} />, {
      dispatch: () => Promise.resolve(failed('core.local_only')),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create my voice' }));
    fireEvent.change(screen.getByLabelText('Name your voice'), { target: { value: 'Mira' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send and create my voice' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Consent saved')).toBeTruthy();
  });

  it('cloned: Withdraw names what it deletes before voice.withdrawConsent', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={fixture('cloned')} />, { dispatch });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw consent' }));
    expect(screen.getByText(/You can’t undo it\./)).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw and delete my voice' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('voice.withdrawConsent', { projectId: null, consentId: CONSENT }),
    );
    expect(await screen.findByText(/Consent withdrawn\./)).toBeTruthy();
  });

  it('failed: offers Record again', () => {
    wrap(
      <CardView card={fixture('failed')} />,
      actions({ voiceCapture: microphone().capture, dispatch: () => Promise.resolve(ok()) }),
    );
    expect(screen.getByText('The recording didn’t work. Nothing was saved.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Record again' }));
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeTruthy();
  });

  it('shows no consent line under terms this build does not have', () => {
    wrap(<CardView card={{ ...fixture('ready'), termsVersion: '9' }} />);
    expect(document.querySelector('[data-slot=consent-line]')).toBeNull();
    expect(screen.getByText(/Update Taalcut to record it/)).toBeTruthy();
  });
});
