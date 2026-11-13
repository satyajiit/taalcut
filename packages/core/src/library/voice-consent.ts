// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A speaker's recorded consent to clone their voice (P3-B6): who, in which language, under which terms, and the
 * recording that proves it. @taalcut/library keeps the store; the recording lives in app data, is never synced and
 * is uploaded only to make the clone. Only a person records, consents or clones (VOICE_CONSENT_COMMANDS).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type VoiceConsentId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { languageTagSchema, sha256Schema } from '../templates/template-parts';

/** Bump when counsel's consent line or terms change; older consents stop counting. */
export const VOICE_CONSENT_TERMS_VERSION = '1';
/** The transcript of the recording must match the consent line this closely (token similarity). */
export const VOICE_CONSENT_PHRASE_MATCH = 0.85;

export const voiceCloneSchema = z.object({
  provider: z.string().min(1).max(64),
  voiceId: z.string().min(1).max(64),
  createdAt: z.int().nonnegative(),
});

export const voiceConsentSchema = z.object({
  id: idSchema<'VoiceConsent'>(),
  /** Typed by the speaker; shown back to them; never sent to a model. */
  speakerName: z.string().trim().min(1).max(80),
  language: languageTagSchema,
  termsVersion: z.string().min(1).max(16),
  recordingSha256: sha256Schema,
  recordingDurationMs: z.int().min(60_000).max(600_000),
  /** Token similarity of the local transcript to the consent line (audio stores none under VOICE_CONSENT_PHRASE_MATCH). */
  phraseMatch: z.number().min(0).max(1),
  recordedAt: z.int().nonnegative(),
  /** Set once a clone exists. */
  clone: voiceCloneSchema.nullable(),
});
export type VoiceConsent = z.output<typeof voiceConsentSchema>;

export interface VoiceConsentStore {
  get(id: VoiceConsentId): AsyncResult<VoiceConsent | null>;
  list(): AsyncResult<VoiceConsent[]>;
  /** The recording's path in app data, for the clone upload only. */
  recordingPath(id: VoiceConsentId): AsyncResult<string>;
  /** Moves the claimed capture (voiceCaptureFilesContract.claim) into the store with the consent. */
  put(consent: VoiceConsent, recording: { readonly captureKey: string }): AsyncResult<void>;
  setClone(id: VoiceConsentId, clone: VoiceConsent['clone']): AsyncResult<void>;
  /** Deletes the row and the recording file. */
  delete(id: VoiceConsentId): AsyncResult<void>;
}
export const VoiceConsentStoreToken = createToken<VoiceConsentStore>('core.voiceConsentStore');
