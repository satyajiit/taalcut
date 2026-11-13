// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { EMULATOR_PROJECT_ID, parseEmulatorAddress, resolveFirebaseSetup } from '#lib/firebase/config';
import { FormStepError, outcomeFromError } from '#lib/firebase/outcome';

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

describe('what the form shows after a send', () => {
  const online = { online: true };
  const fire = (code: string, message = code) => Object.assign(new Error(message), { code });

  it('says a refused write or a failed bot check was refused', () => {
    expect(outcomeFromError(fire('permission-denied'), online)).toEqual({ kind: 'error', cause: 'refused' });
    expect(outcomeFromError(new FormStepError('app-check'), online)).toEqual({ kind: 'error', cause: 'refused' });
    expect(outcomeFromError(fire('unauthenticated'), online)).toEqual({ kind: 'error', cause: 'refused' });
  });

  it('is offline when the browser says so or Firestore is unavailable', () => {
    expect(outcomeFromError(fire('unknown', 'Failed to fetch'), { online: false })).toEqual({ kind: 'offline' });
    expect(outcomeFromError(new FormStepError('load-failed'), { online: false })).toEqual({ kind: 'offline' });
    expect(outcomeFromError(fire('unavailable'), online)).toEqual({ kind: 'offline' });
  });

  it('names the cause otherwise', () => {
    expect(outcomeFromError(fire('resource-exhausted'), online)).toEqual({ kind: 'error', cause: 'busy' });
    expect(outcomeFromError(new FormStepError('timeout'), online)).toEqual({ kind: 'error', cause: 'timeout' });
    expect(outcomeFromError(fire('deadline-exceeded'), online)).toEqual({ kind: 'error', cause: 'timeout' });
    expect(outcomeFromError(new FormStepError('load-failed'), online)).toEqual({ kind: 'error', cause: 'load-failed' });
    expect(outcomeFromError(fire('unknown', 'Request failed with error: Failed to fetch'), online)).toEqual({
      kind: 'error',
      cause: 'unreachable',
    });
    expect(outcomeFromError(fire('internal'), online)).toEqual({ kind: 'error', cause: 'unknown' });
  });
});
