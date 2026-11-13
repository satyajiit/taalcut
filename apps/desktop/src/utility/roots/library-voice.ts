// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The voice consent store in the agent process (P3-B6): the library's VoiceConsentStore by core's token, lazy,
 * keeping recordings in `<userData>/voice-consent/recordings`.
 *
 * Audio's consent command claims the capture from main first (voiceCaptureFilesContract.claim answers once,
 * agent-audio-consent.ts), so the store doesn't claim again: it finds the claimed file where main finished it,
 * `<userData>/voice-consent/captures/<captureId>.wav` (shared/voice-consent-paths.ts, main's capture-files.ts), and keeps it
 * only if its sha256 is the consent's. The capture id is a ULID, so the path can't leave the folder.
 */
import { join } from 'node:path';
import { ok, VoiceConsentStoreToken, type Container, type VoiceCaptureId } from '@taalcut/core';
import { createVoiceConsentStore, type VoiceCaptureSource } from '@taalcut/library';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { voiceCapturesDir, voiceRecordingsDir } from '../../shared/voice-consent-paths';

/** Where main left a finished, claimed capture. */
export function claimedCaptures(userData: string): VoiceCaptureSource {
  return {
    locate: async (captureKey: VoiceCaptureId) => ok(join(voiceCapturesDir(userData), `${captureKey}.wav`)),
  };
}

export function registerLibraryVoice(container: Container, config: Pick<UtilityConfig, 'userData'>): void {
  container.factory(
    VoiceConsentStoreToken,
    ({ db }) =>
      createVoiceConsentStore(db, {
        dir: voiceRecordingsDir(config.userData),
        captures: claimedCaptures(config.userData),
      }),
    { deps: { db: LibraryDatabaseToken } },
  );
}
