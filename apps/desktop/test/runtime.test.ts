// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { APP_ORIGIN, devServerOriginOf, isTrustedUrl, originOf, resolveRuntime } from '../src/main/runtime';

describe('resolveRuntime', () => {
  it('loads app://taalcut/ and trusts only it when packaged, whatever the environment says', () => {
    const runtime = resolveRuntime({ TAALCUT_RENDERER_URL: 'http://localhost:5173' }, true);
    expect(runtime).toEqual({
      packaged: true,
      startUrl: 'app://taalcut/',
      trustedOrigins: [APP_ORIGIN],
      devServerOrigin: undefined,
      devTools: false,
    });
  });

  it('uses the Vite dev server when TAALCUT_RENDERER_URL is set in development', () => {
    const runtime = resolveRuntime({ TAALCUT_RENDERER_URL: 'http://localhost:5173/some/path' }, false);
    expect(runtime.startUrl).toBe('http://localhost:5173/');
    expect(runtime.devServerOrigin).toBe('http://localhost:5173');
    expect(runtime.trustedOrigins).toEqual([APP_ORIGIN, 'http://localhost:5173']);
    expect(runtime.devTools).toBe(true);
  });

  it('falls back to app:// in development without a dev server', () => {
    const runtime = resolveRuntime({}, false);
    expect(runtime.startUrl).toBe('app://taalcut/');
    expect(runtime.trustedOrigins).toEqual([APP_ORIGIN]);
  });
});

describe('devServerOriginOf', () => {
  it.each(['http://localhost:5173', 'http://127.0.0.1:4000', 'http://[::1]:5173'])(
    'accepts loopback %s',
    (url) => {
      expect(devServerOriginOf(url)).toBe(new URL(url).origin);
    },
  );

  it.each(['https://localhost:5173', 'http://example.com:5173', 'http://192.168.1.4:5173', 'not a url'])(
    'refuses %s',
    (url) => {
      expect(() => devServerOriginOf(url)).toThrow(/TAALCUT_RENDERER_URL/);
    },
  );
});

describe('originOf and isTrustedUrl', () => {
  it('builds the origin of app:// URLs by hand (Node says "null")', () => {
    expect(new URL('app://taalcut/x').origin).toBe('null');
    expect(originOf('app://taalcut/projects/1?q=2')).toBe('app://taalcut');
    expect(originOf('http://localhost:5173/x')).toBe('http://localhost:5173');
    expect(originOf('about:blank')).toBeUndefined();
    expect(originOf('garbage')).toBeUndefined();
  });

  it('trusts only exact origins', () => {
    const trusted = [APP_ORIGIN];
    expect(isTrustedUrl('app://taalcut/', trusted)).toBe(true);
    expect(isTrustedUrl('app://taalcut.evil/', trusted)).toBe(false);
    expect(isTrustedUrl('app://other/', trusted)).toBe(false);
    expect(isTrustedUrl('https://taalcut/', trusted)).toBe(false);
    expect(isTrustedUrl('file:///Applications/Taalcut.app/', trusted)).toBe(false);
    expect(isTrustedUrl('http://localhost:5173/', trusted)).toBe(false);
  });
});
