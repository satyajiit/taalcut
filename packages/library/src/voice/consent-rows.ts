// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** voice_consents rows ↔ core's VoiceConsent, validated with voiceConsentSchema both ways. */
import { err, ok, ValidationError, voiceConsentSchema, type Result, type VoiceConsent } from '@taalcut/core';
import { z } from 'zod';
import type { voiceConsents } from '../schema/voice';

export type VoiceConsentRow = typeof voiceConsents.$inferSelect;

function invalid(field: string, error: z.ZodError): Result<never> {
  return err(ValidationError({ field }, { detail: z.prettifyError(error).slice(0, 2000) }));
}

export function parseConsent(consent: VoiceConsent): Result<VoiceConsent> {
  const parsed = voiceConsentSchema.safeParse(consent);
  return parsed.success ? ok(parsed.data) : invalid('consent', parsed.error);
}

export function toRow(consent: VoiceConsent, now: number): VoiceConsentRow {
  return {
    id: consent.id,
    speakerName: consent.speakerName,
    language: consent.language,
    termsVersion: consent.termsVersion,
    recordingSha256: consent.recordingSha256,
    recordingDurationMs: consent.recordingDurationMs,
    phraseMatch: consent.phraseMatch,
    recordedAt: consent.recordedAt,
    clone: consent.clone,
    updatedAt: now,
  };
}

/** A stored row as core's VoiceConsent; one that no longer parses is an error, never a guess. */
export function fromRow(row: VoiceConsentRow): Result<VoiceConsent> {
  const { updatedAt: _updatedAt, ...fields } = row;
  const parsed = voiceConsentSchema.safeParse(fields);
  return parsed.success ? ok(parsed.data) : invalid('voice_consent', parsed.error);
}
