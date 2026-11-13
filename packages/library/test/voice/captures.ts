// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The voice consent store tests' fixture: a finished capture main wrote, and the consent that hashes it. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, VOICE_CONSENT_TERMS_VERSION, type VoiceCaptureId, type VoiceConsent } from '@taalcut/core';

export interface WrittenCapture {
  readonly captureKey: VoiceCaptureId;
  readonly consent: VoiceConsent;
}

/** Writes `<captures>/<key>.wav` with `bytes` (0600) and returns its key and a consent recorded at `recordedAt`. */
export function writeCapture(
  captures: string,
  recordedAt: number,
  bytes = 'RIFF-pretend-recording',
): WrittenCapture {
  const captureKey = newId<'VoiceCapture'>();
  writeFileSync(join(captures, `${captureKey}.wav`), bytes, { mode: 0o600 });
  return {
    captureKey,
    consent: {
      id: newId<'VoiceConsent'>(),
      speakerName: 'Asha Rao',
      language: 'hi',
      termsVersion: VOICE_CONSENT_TERMS_VERSION,
      recordingSha256: createHash('sha256').update(bytes).digest('hex'),
      recordingDurationMs: 75_000,
      phraseMatch: 0.93,
      recordedAt,
      clone: null,
    },
  };
}
