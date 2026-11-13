// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Own-voice consents (P3-B6): core's VoiceConsentStore over migration 22, with the recordings it keeps. */
export {
  createVoiceConsentStore,
  type VoiceCaptureSource,
  type VoiceConsentStoreOptions,
} from './consent-store';
export { VoiceRecordingMismatch } from './errors';
