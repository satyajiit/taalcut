// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The preview player's frame (packages/render SPEC section 5): subframes may
 * load only app://preview, the main frame never does, and the frame gets no
 * permission even if one is ever allow-listed.
 */
import { describe, expect, it } from 'vitest';
import {
  GRANTED_PERMISSIONS,
  isFrameNavigationAllowed,
  isPermissionGranted,
  PREVIEW_FRAME_ORIGIN,
} from '../src/main/security/policy';
import { secureWebPreferences } from '../src/main/security/web-preferences';

const trusted = ['app://taalcut', 'http://localhost:5173'];

describe('frame navigation', () => {
  it('lets a subframe load only the preview origin', () => {
    expect(PREVIEW_FRAME_ORIGIN).toBe('app://preview');
    expect(
      isFrameNavigationAllowed('app://preview/0123456789abcdef0123456789abcdef/index.html', false, trusted),
    ).toBe(true);
    expect(isFrameNavigationAllowed('app://taalcut/', false, trusted)).toBe(false);
    expect(isFrameNavigationAllowed('app://media/proxies/ab/x.mp4', false, trusted)).toBe(false);
    expect(isFrameNavigationAllowed('https://example.com/', false, trusted)).toBe(false);
    expect(isFrameNavigationAllowed('about:blank', false, trusted)).toBe(false);
    expect(isFrameNavigationAllowed('javascript:alert(1)', false, trusted)).toBe(false);
  });

  it('keeps the main frame on the app origins: never the preview origin', () => {
    expect(isFrameNavigationAllowed('app://taalcut/renders', true, trusted)).toBe(true);
    expect(isFrameNavigationAllowed('http://localhost:5173/', true, trusted)).toBe(true);
    expect(
      isFrameNavigationAllowed('app://preview/0123456789abcdef0123456789abcdef/index.html', true, trusted),
    ).toBe(false);
  });

  it('keeps node integration out of subframes', () => {
    expect(secureWebPreferences({ preload: 'p', devTools: false }).nodeIntegrationInSubFrames).toBe(false);
  });
});

describe('preview frame permissions', () => {
  it('are denied even when a permission is allow-listed for the app', () => {
    const granted = GRANTED_PERMISSIONS as Set<string>;
    granted.add('fullscreen');
    try {
      expect(isPermissionGranted('fullscreen', 'app://taalcut/', ['app://taalcut', 'app://preview'])).toBe(
        true,
      );
      expect(
        isPermissionGranted('fullscreen', 'app://preview/x/index.html', ['app://taalcut', 'app://preview']),
      ).toBe(false);
    } finally {
      granted.delete('fullscreen');
    }
  });
});
