// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The voice consent card's microphone (P3-B6): `media` is granted for audio only, only to the app's own pages,
 * never to render's preview frame, for a request and for a check alike, and only while main has a consent
 * recording under way (security review SV-6).
 */
import { describe, expect, it } from 'vitest';
import { isPermissionGranted, PREVIEW_FRAME_ORIGIN } from '../src/main/security/policy';
import { createMicrophoneGate } from '../src/main/voice/microphone-gate';

const trusted = ['app://taalcut', PREVIEW_FRAME_ORIGIN];
const page = 'app://taalcut/settings';

describe('media permission requests', () => {
  it('grants a request for the microphone alone', () => {
    expect(isPermissionGranted('media', page, trusted, { mediaTypes: ['audio'], recording: true })).toBe(
      true,
    );
  });

  it('refuses the microphone when no consent recording is under way', () => {
    expect(isPermissionGranted('media', page, trusted, { mediaTypes: ['audio'] })).toBe(false);
    expect(isPermissionGranted('media', page, trusted, { mediaTypes: ['audio'], recording: false })).toBe(
      false,
    );
    expect(isPermissionGranted('media', 'app://taalcut', trusted, { mediaType: 'audio' })).toBe(false);
  });

  it('refuses the camera, the camera with the microphone, and a request that names no kind', () => {
    const recording = true;
    expect(isPermissionGranted('media', page, trusted, { mediaTypes: ['video'], recording })).toBe(false);
    expect(isPermissionGranted('media', page, trusted, { mediaTypes: ['audio', 'video'], recording })).toBe(
      false,
    );
    expect(isPermissionGranted('media', page, trusted, { mediaTypes: [], recording })).toBe(false);
    expect(isPermissionGranted('media', page, trusted, { recording })).toBe(false);
  });

  it('refuses a page outside the app and the preview frame, even for audio', () => {
    expect(isPermissionGranted('media', 'https://example.com/', trusted, { mediaTypes: ['audio'] })).toBe(
      false,
    );
    expect(
      isPermissionGranted('media', `${PREVIEW_FRAME_ORIGIN}/x/index.html`, trusted, {
        mediaTypes: ['audio'],
      }),
    ).toBe(false);
  });
});

describe('media permission checks', () => {
  it('answers yes for audio from the app origin only', () => {
    expect(
      isPermissionGranted('media', 'app://taalcut', trusted, { mediaType: 'audio', recording: true }),
    ).toBe(true);
    expect(isPermissionGranted('media', 'app://taalcut', trusted, { mediaType: 'video' })).toBe(false);
    expect(isPermissionGranted('media', 'app://taalcut', trusted, { mediaType: 'unknown' })).toBe(false);
    expect(isPermissionGranted('media', 'https://example.com', trusted, { mediaType: 'audio' })).toBe(false);
    expect(isPermissionGranted('media', PREVIEW_FRAME_ORIGIN, trusted, { mediaType: 'audio' })).toBe(false);
  });

  it('gives other permissions nothing from media facts', () => {
    expect(isPermissionGranted('geolocation', page, trusted, { mediaTypes: ['audio'] })).toBe(false);
    expect(isPermissionGranted('notifications', page, trusted, { mediaType: 'audio' })).toBe(false);
  });
});

describe('the microphone gate', () => {
  it('stays closed until main binds it, then follows the capture store', () => {
    const gate = createMicrophoneGate();
    expect(gate.isOpen()).toBe(false);
    let recording = false;
    gate.bind({ isRecording: () => recording });
    expect(gate.isOpen()).toBe(false);
    recording = true;
    expect(gate.isOpen()).toBe(true);
  });
});
