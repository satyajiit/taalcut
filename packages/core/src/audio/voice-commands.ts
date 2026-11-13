// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Voice commands (P3-B6). Consent commands: person sources only (the agent and MCP never record, consent or
 * clone), app-wide. `voice.createClone` also needs the voice module's upload consent, since it sends the
 * recording off this Mac. Voiceover commands put a voiceover and its voice track on a timeline; their inverse is
 * `timeline.restore { tracks, voiceover }`. Handlers: @taalcut/audio.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, ULID_PATTERN } from '../basics/ids';
import { languageTagSchema } from '../templates/template-parts';
import { trackSchema } from '../timeline/timeline-items';
import { voiceoverSchema } from '../timeline/voiceover';

export const VOICE_CONSENT_COMMANDS = {
  /** write; inverse voice.withdrawConsent. */
  recordConsent: 'voice.recordConsent',
  /** destructive: the consent, the recording and any clone at the provider. No inverse. */
  withdrawConsent: 'voice.withdrawConsent',
  /** external (uploads the recording); inverse voice.deleteClone. */
  createClone: 'voice.createClone',
  /** destructive. */
  deleteClone: 'voice.deleteClone',
} as const;

const consentId = idSchema<'VoiceConsent'>();
const appWide = { projectId: z.null().default(null) };

export const voiceConsentCommandPayloads = {
  [VOICE_CONSENT_COMMANDS.recordConsent]: z.object({
    ...appWide,
    consentId,
    /** From the voice capture service (voiceCaptureContract.stop); never a path. */
    captureKey: z.string().regex(ULID_PATTERN),
    speakerName: z.string().trim().min(1).max(80),
    language: languageTagSchema,
    termsVersion: z.string().min(1).max(16),
  }),
  [VOICE_CONSENT_COMMANDS.withdrawConsent]: z.object({ ...appWide, consentId }),
  [VOICE_CONSENT_COMMANDS.createClone]: z.object({
    ...appWide,
    consentId,
    name: z.string().trim().min(1).max(60),
  }),
  [VOICE_CONSENT_COMMANDS.deleteClone]: z.object({ ...appWide, consentId }),
};

export const VOICE_COMMANDS = {
  /** write; inverse timeline.restore { tracks, voiceover }. */
  applyVoiceover: 'voice.applyVoiceover',
  /** write; inverse timeline.restore { tracks, voiceover }. */
  removeVoiceover: 'voice.removeVoiceover',
} as const;

const target = {
  projectId: idSchema<'Project'>(),
  timelineId: idSchema<'Timeline'>(),
  /** When given, a stale revision is core.conflict. */
  revision: z.int().positive().optional(),
};

export const voiceCommandPayloads = {
  [VOICE_COMMANDS.applyVoiceover]: z.object({
    ...target,
    voiceover: voiceoverSchema,
    /** The voice track (an audio track of role 'voice') as it should be: clips and gaps. */
    track: trackSchema,
  }),
  [VOICE_COMMANDS.removeVoiceover]: z.object(target),
};
