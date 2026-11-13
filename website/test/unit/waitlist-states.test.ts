// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { EMULATOR_PROJECT_ID, parseEmulatorAddress, resolveFirebaseSetup } from '#lib/firebase/config';
import { FormStepError, outcomeFromError } from '#lib/firebase/outcome';
import { moodFor } from '#components/waitlist/mood';

const LIVE = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'taalcut.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'taalcut',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:2:web:3',
  NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_KEY: 'site-key',
};

describe('which Firebase a build writes to', () => {
  it('is closed with no config, and names what is missing', () => {
    expect(resolveFirebaseSetup({})).toMatchObject({ mode: 'closed', missing: Object.keys(LIVE) });
    expect(resolveFirebaseSetup({ ...LIVE, NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_KEY: ' ' })).toEqual({
      mode: 'closed',
      missing: ['NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_KEY'],
    });
  });

  it('is live with every key, App Check included', () => {
    expect(resolveFirebaseSetup(LIVE)).toEqual({
      mode: 'live',
      options: {
        apiKey: 'key',
        authDomain: 'taalcut.firebaseapp.com',
        projectId: 'taalcut',
        appId: '1:2:web:3',
      },
      recaptchaKey: 'site-key',
      measurementId: null,
    });
  });

  it('counts visits only when a live build names a well-formed measurement id', () => {
    const live = (id: string) => resolveFirebaseSetup({ ...LIVE, NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: id });
    expect(live(' G-PGM40PQ26X ')).toMatchObject({ mode: 'live', measurementId: 'G-PGM40PQ26X' });
    for (const bad of ['', 'UA-123-1', 'G-', 'g-abc123', 'G-ABC 123']) expect(live(bad), bad).toMatchObject({ measurementId: null });
    expect(resolveFirebaseSetup({ NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: 'G-PGM40PQ26X' })).toMatchObject({ mode: 'closed' });
  });

  it('uses the emulator under the demo project whenever an emulator is named, even beside live config', () => {
    expect(resolveFirebaseSetup({ ...LIVE, NEXT_PUBLIC_FIREBASE_EMULATOR: '127.0.0.1:8183' })).toEqual({
      mode: 'emulator',
      projectId: EMULATOR_PROJECT_ID,
      host: '127.0.0.1',
      port: 8183,
    });
    expect(EMULATOR_PROJECT_ID.startsWith('demo-')).toBe(true);
  });

  it('reads an emulator address only as host:port', () => {
    expect(parseEmulatorAddress('localhost:8080')).toEqual({ host: 'localhost', port: 8080 });
    for (const bad of [undefined, '', '8080', 'localhost', 'localhost:0', 'localhost:70000', 'http://x:1']) {
      expect(parseEmulatorAddress(bad), String(bad)).toBeNull();
    }
  });
});

describe('what a form shows after a send', () => {
  const waitlist = { online: true, refusalMeansListed: true };
  const contact = { online: true, refusalMeansListed: false };
  const fire = (code: string, message = code) => Object.assign(new Error(message), { code });

  it('shows a repeat sign-up exactly like a new one', () => {
    expect(outcomeFromError(fire('permission-denied'), waitlist)).toEqual({ kind: 'ok' });
    expect(outcomeFromError(fire('permission-denied'), contact)).toEqual({ kind: 'error', cause: 'refused' });
  });

  it('never mistakes a failed App Check for a repeat sign-up', () => {
    expect(outcomeFromError(new FormStepError('app-check'), waitlist)).toEqual({
      kind: 'error',
      cause: 'refused',
    });
    expect(outcomeFromError(fire('unauthenticated'), waitlist)).toEqual({ kind: 'error', cause: 'refused' });
  });

  it('is offline when the browser says so or Firestore is unavailable', () => {
    expect(outcomeFromError(fire('unknown', 'Failed to fetch'), { ...waitlist, online: false })).toEqual({
      kind: 'offline',
    });
    expect(outcomeFromError(new FormStepError('load-failed'), { ...contact, online: false })).toEqual({
      kind: 'offline',
    });
    expect(outcomeFromError(fire('unavailable'), waitlist)).toEqual({ kind: 'offline' });
  });

  it('names the cause otherwise', () => {
    expect(outcomeFromError(fire('resource-exhausted'), waitlist)).toEqual({ kind: 'error', cause: 'busy' });
    expect(outcomeFromError(new FormStepError('timeout'), waitlist)).toEqual({
      kind: 'error',
      cause: 'timeout',
    });
    expect(outcomeFromError(fire('deadline-exceeded'), contact)).toEqual({ kind: 'error', cause: 'timeout' });
    expect(outcomeFromError(new FormStepError('load-failed'), waitlist)).toEqual({
      kind: 'error',
      cause: 'load-failed',
    });
    expect(outcomeFromError(fire('unknown', 'Request failed with error: Failed to fetch'), waitlist)).toEqual(
      {
        kind: 'error',
        cause: 'unreachable',
      },
    );
    expect(outcomeFromError(fire('internal'), waitlist)).toEqual({ kind: 'error', cause: 'unknown' });
  });
});

describe('Kaatu beside the form', () => {
  it('follows the form', () => {
    expect(moodFor('idle', false, 'wave', true)).toBe('wave');
    expect(moodFor('idle', true, 'wave', true)).toBe('glance');
    expect(moodFor('submitting', true, 'idle', true)).toBe('thinking');
    expect(moodFor('success', false, 'idle', true)).toBe('delighted');
    for (const status of ['invalid', 'error', 'offline'] as const)
      expect(moodFor(status, true, 'idle', true)).toBe('oops');
  });

  it('sleeps while the waitlist is closed', () => {
    expect(moodFor('idle', true, 'wave', false)).toBe('asleep');
  });
});
