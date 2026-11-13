// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the consent commands do (SPEC P3.3, PRD 10.2), one step each: store a consent from a claimed in-app
 * recording that says the consent line (at least 60 s, heard on this Mac), clone exactly that recording while its
 * hash still matches, and delete a consent's provider voice. consent-commands.ts wraps them as commands.
 */
import {
  err,
  NotFoundError,
  ok,
  VOICE_CONSENT_TERMS_VERSION,
  ValidationError,
  type AsyncResult,
  type Clock,
  type VoiceConsent,
  type VoiceConsentId,
  type VoiceConsentStore,
  type VoiceProvider,
} from '@taalcut/core';
import { checkConsentRecording, type LocalTranscriber } from './consent';
import { CloneSourceRefused, ConsentRecordingLength, VoiceConsentRequired } from './errors';
import { readRecordingFacts } from './recording';

/** Main's voice capture files (voiceCaptureFilesContract.claim): the capture's path, once. */
export interface VoiceCaptureFiles {
  claim(captureKey: string): AsyncResult<{ readonly path: string }>;
}

export interface ConsentCommandDeps {
  readonly consents: VoiceConsentStore;
  readonly captures: VoiceCaptureFiles;
  readonly transcriber: LocalTranscriber;
  readonly provider: VoiceProvider;
  readonly clock: Clock;
  /** The clone record's provider id. */
  readonly providerName?: string;
}

/** The consent recording's length bounds (core's voiceConsentSchema). */
const RECORDING_MS = { min: 60_000, max: 600_000 } as const;

export interface RecordConsentInput {
  readonly consentId: VoiceConsentId;
  readonly captureKey: string;
  readonly speakerName: string;
  readonly language: string;
  readonly termsVersion: string;
}

export async function recordConsent(
  deps: ConsentCommandDeps,
  input: RecordConsentInput,
): AsyncResult<{ readonly phraseMatch: number }> {
  if (input.termsVersion !== VOICE_CONSENT_TERMS_VERSION)
    return err(
      ValidationError({ field: 'termsVersion' }, { detail: `terms ${input.termsVersion} aren't current` }),
    );
  const claimed = await deps.captures.claim(input.captureKey);
  if (!claimed.ok) return claimed;
  const facts = await readRecordingFacts(claimed.value.path);
  if (!facts.ok) return facts;
  const { durationMs, sha256 } = facts.value;
  if (durationMs < RECORDING_MS.min || durationMs > RECORDING_MS.max)
    return err(ConsentRecordingLength({ seconds: Math.round(durationMs / 1000) }));
  const checked = await checkConsentRecording(deps.transcriber, {
    path: claimed.value.path,
    language: input.language,
    speakerName: input.speakerName,
  });
  if (!checked.ok) return checked;
  const consent: VoiceConsent = {
    id: input.consentId,
    speakerName: input.speakerName,
    language: input.language,
    termsVersion: input.termsVersion,
    recordingSha256: sha256,
    recordingDurationMs: durationMs,
    phraseMatch: checked.value.phraseMatch,
    recordedAt: deps.clock.now(),
    clone: null,
  };
  const stored = await deps.consents.put(consent, { captureKey: input.captureKey });
  return stored.ok ? ok({ phraseMatch: checked.value.phraseMatch }) : stored;
}

/** Clones the consent's own recording, refusing any other file or a consent under older terms. */
export async function createClone(
  deps: ConsentCommandDeps,
  input: { readonly consentId: VoiceConsentId; readonly name: string },
): AsyncResult<{ readonly voiceId: string; readonly requiresVerification: boolean }> {
  const consent = await deps.consents.get(input.consentId);
  if (!consent.ok) return consent;
  if (!consent.value || consent.value.termsVersion !== VOICE_CONSENT_TERMS_VERSION)
    return err(VoiceConsentRequired());
  const path = await deps.consents.recordingPath(input.consentId);
  if (!path.ok) return err(VoiceConsentRequired(undefined, { detail: path.error.code }));
  const facts = await readRecordingFacts(path.value);
  if (!facts.ok) return facts;
  if (facts.value.sha256 !== consent.value.recordingSha256)
    return err(CloneSourceRefused(undefined, { detail: "the file isn't the consent's recording" }));
  const clone = await deps.provider.createClone({
    consentId: input.consentId,
    recordingPath: path.value,
    name: input.name,
  });
  if (!clone.ok) return clone;
  const set = await deps.consents.setClone(input.consentId, {
    provider: deps.providerName ?? 'elevenlabs',
    voiceId: clone.value.voiceId,
    createdAt: deps.clock.now(),
  });
  return set.ok ? clone : set;
}

/** Deletes the consent's voice at the provider (an unknown voice is success there) and returns the consent. */
export async function deleteProviderVoice(
  deps: Pick<ConsentCommandDeps, 'consents' | 'provider'>,
  consentId: VoiceConsentId,
): AsyncResult<VoiceConsent> {
  const consent = await deps.consents.get(consentId);
  if (!consent.ok) return consent;
  if (!consent.value) return err(NotFoundError({ entity: 'voiceConsent', id: consentId }));
  if (consent.value.clone) {
    const deleted = await deps.provider.deleteClone(consent.value.clone.voiceId);
    if (!deleted.ok) return deleted;
  }
  return ok(consent.value);
}
