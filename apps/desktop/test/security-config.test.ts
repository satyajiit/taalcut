// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { APP_CSP, APP_CSP_DIRECTIVES, appResponseHeaders, devServerCsp } from '../src/main/security/csp';
import {
  GRANTED_PERMISSIONS,
  isNavigationAllowed,
  isPermissionGranted,
  windowOpenDecision,
} from '../src/main/security/policy';
import { secureWebPreferences } from '../src/main/security/web-preferences';

describe('secureWebPreferences', () => {
  it('locks every security-relevant preference, including ones Electron does not report back', () => {
    expect(secureWebPreferences({ preload: '/app/out/preload/index.cjs', devTools: false })).toEqual({
      preload: '/app/out/preload/index.cjs',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      devTools: false,
    });
  });

  it('never sets enableBlinkFeatures', () => {
    expect(secureWebPreferences({ preload: 'p', devTools: true })).not.toHaveProperty('enableBlinkFeatures');
  });
});

describe('CSP', () => {
  it('is the agreed strict policy, tightened with worker-src, frame-src and manifest-src', () => {
    expect(APP_CSP).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: app://media app://preview; " +
        "media-src 'self' blob: app://media app://preview; font-src 'self'; connect-src 'self'; worker-src 'self'; " +
        'frame-src app://preview; ' +
        "manifest-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
  });

  it('never allows inline script, eval or remote origins in production', () => {
    for (const sources of Object.values(APP_CSP_DIRECTIVES)) {
      for (const source of sources) {
        expect(source).not.toMatch(/unsafe-|https?:|\*|wss?:/);
      }
    }
  });

  it('loosens only script, style and connect for the dev server', () => {
    const csp = devServerCsp('http://localhost:5173');
    expect(csp).toContain("script-src 'self' 'unsafe-inline';");
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).toContain("connect-src 'self' ws://localhost:5173;");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('sends the CSP and hardening headers on every app:// response', () => {
    expect(appResponseHeaders('text/html; charset=utf-8')).toEqual({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': APP_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
  });
});

describe('permissions', () => {
  const trusted = ['app://taalcut'];

  it('grants nothing yet', () => {
    expect(GRANTED_PERMISSIONS.size).toBe(0);
    for (const permission of [
      'media',
      'geolocation',
      'notifications',
      'clipboard-read',
      'openExternal',
      'hid',
    ]) {
      expect(isPermissionGranted(permission, 'app://taalcut/', trusted)).toBe(false);
    }
  });

  it('would grant an allow-listed permission only to the app origin', () => {
    const granted = GRANTED_PERMISSIONS as Set<string>;
    granted.add('fullscreen');
    try {
      expect(isPermissionGranted('fullscreen', 'app://taalcut/', trusted)).toBe(true);
      expect(isPermissionGranted('fullscreen', 'https://example.com/', trusted)).toBe(false);
    } finally {
      granted.delete('fullscreen');
    }
  });
});

describe('navigation and new windows', () => {
  const trusted = ['app://taalcut', 'http://localhost:5173'];

  it('allows only trusted origins', () => {
    expect(isNavigationAllowed('app://taalcut/settings', trusted)).toBe(true);
    expect(isNavigationAllowed('http://localhost:5173/', trusted)).toBe(true);
    expect(isNavigationAllowed('https://example.com/', trusted)).toBe(false);
    expect(isNavigationAllowed('file:///etc/passwd', trusted)).toBe(false);
    expect(isNavigationAllowed('javascript:alert(1)', trusted)).toBe(false);
    expect(isNavigationAllowed('http://localhost:5174/', trusted)).toBe(false);
  });

  it('denies every window.open', () => {
    expect(windowOpenDecision()).toEqual({ action: 'deny' });
  });
});
