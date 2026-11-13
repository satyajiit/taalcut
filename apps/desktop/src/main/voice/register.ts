// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's voice capture (P3-B6) in its container: one store for the consent card's window router and the agent
 * process's claim, under `<userData>/voice-consent/captures` (only main and the consent store read
 * `voice-consent`).
 */
import { ClockToken, createToken, type Container } from '@taalcut/core';
import { voiceCapturesDir } from '../../shared/voice-consent-paths';
import { createVoiceCaptureStore, type VoiceCaptureStore } from './voice-capture-store';

export const VoiceCaptureStoreToken = createToken<VoiceCaptureStore>('desktop.voiceCaptureStore');

export function registerVoiceCapture(container: Container, userData: string): void {
  container.factory(
    VoiceCaptureStoreToken,
    ({ clock }) => createVoiceCaptureStore({ dir: voiceCapturesDir(userData), clock }),
    { deps: { clock: ClockToken } },
  );
}
