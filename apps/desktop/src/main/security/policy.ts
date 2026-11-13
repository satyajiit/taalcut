// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Decisions behind navigation, new windows and permission requests. Pure, so
 * each rule has a unit test; harden.ts attaches them to Electron.
 */
import { PREVIEW_HOST } from '@taalcut/core';
import { APP_SCHEME, isTrustedUrl, originOf } from '../runtime';

/**
 * Permissions the app grants as asked, and only to its own pages. Empty on purpose: Taalcut needs none.
 * Add one here (with a test and a SECURITY.md line) when a feature needs it. The microphone is not here:
 * `media` has its own rule (isAudioOnly).
 */
export const GRANTED_PERMISSIONS: ReadonlySet<string> = new Set<string>();

/**
 * What Electron says about a `media` ask: the kinds a request wants (`mediaTypes`, permission request) or the
 * one kind a check is about (`mediaType`, permission check). Absent for every other permission.
 */
export interface PermissionFacts {
  readonly mediaTypes?: readonly string[];
  readonly mediaType?: string;
  /** Whether main has a consent recording under way (MicrophoneGate); `media` is refused otherwise (SV-6). */
  readonly recording?: boolean;
}

/**
 * `media` for the voice consent card's recording (P3-B6): the microphone and nothing else, and only while main
 * has that recording under way (`recording`). A request granted only when every kind it asks for is audio; a
 * check only for audio. The camera, the screen and an ask that names no kind are refused.
 */
function isAudioOnly(facts: PermissionFacts): boolean {
  if (facts.mediaTypes)
    return facts.mediaTypes.length > 0 && facts.mediaTypes.every((kind) => kind === 'audio');
  return facts.mediaType === 'audio';
}

export function isPermissionGranted(
  permission: string,
  requestingUrl: string,
  trustedOrigins: readonly string[],
  facts: PermissionFacts = {},
): boolean {
  // The preview player's frame (render's compositions) never gets a permission, whatever the list says.
  if (originOf(requestingUrl) === PREVIEW_FRAME_ORIGIN) return false;
  if (!isTrustedUrl(requestingUrl, trustedOrigins)) return false;
  if (permission === 'media') return facts.recording === true && isAudioOnly(facts);
  return GRANTED_PERMISSIONS.has(permission);
}

/** A frame may navigate only within the app's own origins (checklist 13). */
export function isNavigationAllowed(url: string, trustedOrigins: readonly string[]): boolean {
  return isTrustedUrl(url, trustedOrigins);
}

/** render's preview player page (packages/render SPEC section 5): the only origin a subframe may load. */
export const PREVIEW_FRAME_ORIGIN = `${APP_SCHEME}://${PREVIEW_HOST}`;

/**
 * The main frame stays on the app's origins; a subframe may only be the preview player's iframe on
 * app://preview, which is cross-origin to the app page, so a composition can't reach it.
 */
export function isFrameNavigationAllowed(
  url: string,
  isMainFrame: boolean,
  trustedOrigins: readonly string[],
): boolean {
  if (isMainFrame) return isNavigationAllowed(url, trustedOrigins);
  return originOf(url) === PREVIEW_FRAME_ORIGIN;
}

/**
 * window.open and target=_blank never create a window (checklist 14). A page that should open in the
 * browser goes through `files.openExternal` instead (checklist 15): https pages on core's
 * EXTERNAL_LINK_HOSTS only, checked by the contract and again by main (files-router.ts).
 */
export function windowOpenDecision(): { action: 'deny' } {
  return { action: 'deny' };
}
