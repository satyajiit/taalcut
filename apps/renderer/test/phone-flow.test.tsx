// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1 (the phone flow): what /library/phone says about the Wi-Fi session, worked out from what the transfer
// service streams; where /library/phone lands; the four tabs; listening only once Wi-Fi shows; and a stream that
// fails after it listened, said with its fix, in the flow and where the view is embedded (first run, the chat).
import { I18nProvider } from '@lingui/react';
import {
  transferDeviceSchema,
  transferFileSchema,
  UnknownError,
  type TransferFile,
  type TransferSession,
} from '@taalcut/core';
import { createThemeEngine, localStorageStore } from '@taalcut/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { themeTarget } from '../src/backend/fake/expose';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import type { TransferScenario } from '../src/backend/fake/fake-transfer';
import { PhoneFlowProvider } from '../src/features/library/phone/session/phone-flow';
import { PhonePage } from '../src/features/library/phone/phone-page';
import { connectionOf, landingTab, stepStates } from '../src/features/library/phone/session/connection';
import { FIXTURE_SESSION } from '../src/features/library/phone/session/fixtures';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { accessWordsFor } from '../src/onboarding/setup/sources/device-words';
import { renderApp } from './render-app';

const AT = Date.UTC(2026, 9, 13, 9, 30);
const phone = transferDeviceSchema.parse({
  id: '01K7C5M6Q8PH0NE00000000D01',
  label: 'iPhone',
  platform: 'ios',
  connectedAt: AT,
  lastSeenAt: AT,
});
const file = (n: number, state: TransferFile['state']): TransferFile =>
  transferFileSchema.parse({
    id: `01K7C5M6Q8PH0NE00000000F0${n}`,
    sessionId: FIXTURE_SESSION.id,
    deviceId: phone.id,
    name: `IMG_88${n}0.MOV`,
    sizeBytes: 1000,
    receivedBytes: state === 'uploading' || state === 'paused' ? 400 : 1000,
    state,
    updatedAt: AT,
  });
const listening = (devices: TransferSession['devices'] = []): TransferSession => ({
  ...FIXTURE_SESSION,
  devices,
});
const none = { files: [], error: null } as const;

describe('the connection, from what the transfer service streams', () => {
  it('is off until the flow asks the Mac to listen, then starting until the session arrives', () => {
    expect(connectionOf({ session: null, ...none, enabled: false })).toEqual({ kind: 'off' });
    expect(connectionOf({ session: null, ...none })).toEqual({ kind: 'starting' });
    expect(connectionOf({ session: { ...FIXTURE_SESSION, state: 'starting' }, ...none })).toEqual({
      kind: 'starting',
    });
  });

  it('says a failed stream first, before the session it had or after it never came', () => {
    const error = UnknownError();
    expect(connectionOf({ session: null, files: [], error })).toEqual({ kind: 'failed', error });
    expect(connectionOf({ session: listening([phone]), files: [], error })).toEqual({
      kind: 'failed',
      error,
    });
  });

  it('keeps the reason a session stopped', () => {
    const stopped = { ...FIXTURE_SESSION, state: 'stopped', stopReason: 'no-network' } as const;
    expect(connectionOf({ session: stopped, ...none })).toEqual({ kind: 'stopped', reason: 'no-network' });
  });

  it('waits, then is connected to the phones the session lists', () => {
    expect(connectionOf({ session: listening(), ...none })).toEqual({ kind: 'waiting' });
    expect(connectionOf({ session: listening([phone]), ...none })).toEqual({
      kind: 'connected',
      devices: [phone],
    });
  });

  it('is lost when the phone’s uploads paused and nothing else moves', () => {
    const paused = [file(1, 'paused'), file(2, 'imported')];
    expect(connectionOf({ session: listening([phone]), files: paused, error: null })).toEqual({
      kind: 'lost',
      device: phone,
    });
    // One still sending: the phone is there.
    const moving = [file(1, 'paused'), file(2, 'uploading')];
    expect(connectionOf({ session: listening([phone]), files: moving, error: null }).kind).toBe('connected');
  });
});

describe('where /library/phone lands', () => {
  it('lands on Transfers while a phone is connected, files are on their way or a cable import runs', () => {
    expect(landingTab({ session: listening([phone]), ...none }, false)).toBe('transfers');
    expect(landingTab({ session: listening(), files: [file(1, 'checking')], error: null }, false)).toBe(
      'transfers',
    );
    expect(landingTab({ session: null, ...none }, true)).toBe('transfers');
  });

  it('lands on Wi-Fi otherwise', () => {
    expect(landingTab({ session: null, ...none }, false)).toBe('wifi');
    expect(landingTab({ session: listening(), files: [file(1, 'imported')], error: null }, false)).toBe(
      'wifi',
    );
  });

  it('shows Android file-transfer wording when an Android phone reports locked MTP storage', async () => {
    await activateLocale('en');
    expect(i18n._(accessWordsFor({ platform: 'android', access: 'locked' }))).toBe(
      'On your phone, tap the USB notification and choose File transfer.',
    );
    expect(i18n._(accessWordsFor({ platform: 'ios', access: 'locked' }))).toBe(
      'Unlock your iPhone to carry on.',
    );
  });
});

describe('the steps beside the QR', () => {
  it('starts on the scan, then on picking once a phone is connected, all done once everything landed', () => {
    expect(stepStates({ kind: 'waiting' }, [])).toEqual(['current', 'next', 'next']);
    expect(stepStates({ kind: 'connected', devices: [phone] }, [])).toEqual(['done', 'done', 'current']);
    expect(stepStates({ kind: 'connected', devices: [phone] }, [file(1, 'uploading')])).toEqual([
      'done',
      'done',
      'current',
    ]);
    expect(stepStates({ kind: 'connected', devices: [phone] }, [file(1, 'imported')])).toEqual([
      'done',
      'done',
      'done',
    ]);
  });
});

const flow = (path: string, scenario: TransferScenario) =>
  renderApp(path, { phase2: { transfer: { scenario, speed: 20 } } });

describe('the phone flow', () => {
  it('redirects the old phone entry without starting reception', async () => {
    const { router, controls } = await flow('/library/phone', 'waiting');
    await waitFor(() => expect(router.state.location.pathname).toBe('/library/import/phone-wifi'));
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(controls.transfer.state().opens).toBe(0);
  });
  it('opens nothing on the network for the cable and shows a plugged-in phone live', async () => {
    const { router, controls } = await renderApp('/library/phone/cable', {
      phase2: { transfer: { scenario: 'waiting', speed: 20 } },
      phase3: { usb: { scenario: 'iphone', tickMs: 0 } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/library/import/phone-cable'));
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(controls.transfer.state().opens).toBe(0);
    expect(await screen.findByRole('button', { name: 'Use this phone' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/library\/import\/phone-cable\/.*\/choose$/),
    );
  });
  it('keeps one session across routes once explicitly connected', async () => {
    const { router, controls } = await flow('/library/phone/wifi', 'connected');
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByText(/Connected to/, {}, { timeout: 4000 })).toBeTruthy();
    await act(() => router.navigate({ to: '/library/phone/transfers' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/library/imports'));
    expect(controls.transfer.state().opens).toBe(1);
    expect(controls.transfer.state().listening).toBe(true);
  });
  it('says a failed stream, and Try again listens again', async () => {
    const { controls } = await flow('/library/phone/wifi', 'dropped');
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Taalcut stopped listening', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'QR code to connect your phone' })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    await waitFor(() => expect(controls.transfer.state().opens).toBe(2));
  });
});

describe('the view embedded in first run and the chat', () => {
  it('says a stream that failed after it listened, with Try again', async () => {
    await activateLocale('en');
    const engine = createThemeEngine({ store: localStorageStore() });
    await engine.init();
    const fake = createFakeBackend({
      theme: themeTarget(engine),
      phase2: { transfer: { scenario: 'dropped', speed: 20 } },
    });
    render(
      <I18nProvider i18n={i18n}>
        <BackendProvider backend={fake.client}>
          <PhoneFlowProvider>
            <PhonePage />
          </PhoneFlowProvider>
        </BackendProvider>
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('PIN 7 3 0 2 5 4')).toBeTruthy();
    expect(await screen.findByText('Taalcut stopped listening', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
