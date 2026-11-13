// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Own-voice consent and cloning (SPEC P3.3, PRD 10.2): `voice.recordConsent`, `voice.withdrawConsent`,
 * `voice.createClone`, `voice.deleteClone`. Person sources only: the bus refuses the agent and MCP, and no tool
 * exists for any of them. The only clone source is the in-app recording made through the consent card: main's
 * capture is claimed once, checked (the consent line heard on this Mac, at least 60 s long) and stored with the
 * consent; a clone uploads exactly that recording, and only while its hash matches the consent's
 * (consent-steps.ts).
 */
import {
  defineCommand,
  ok,
  PERSON_SOURCES,
  VOICE_CONSENT_COMMANDS,
  voiceConsentCommandPayloads,
} from '@taalcut/core';
import { createClone, deleteProviderVoice, recordConsent, type ConsentCommandDeps } from './consent-steps';

export type { ConsentCommandDeps, VoiceCaptureFiles } from './consent-steps';

const appWide = () => null;
const person = { sources: PERSON_SOURCES, project: appWide } as const;

export function createConsentCommands(deps: ConsentCommandDeps) {
  const record = defineCommand({
    name: VOICE_CONSENT_COMMANDS.recordConsent,
    payload: voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.recordConsent],
    sideEffect: 'write',
    ...person,
    handle: async (payload) => {
      const stored = await recordConsent(deps, payload);
      if (!stored.ok) return stored;
      return ok({
        result: { consentId: payload.consentId, phraseMatch: stored.value.phraseMatch },
        inverse: {
          name: VOICE_CONSENT_COMMANDS.withdrawConsent,
          payload: { projectId: null, consentId: payload.consentId },
        },
      });
    },
  });

  const withdraw = defineCommand({
    name: VOICE_CONSENT_COMMANDS.withdrawConsent,
    payload: voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.withdrawConsent],
    sideEffect: 'destructive',
    ...person,
    handle: async (payload) => {
      const consent = await deleteProviderVoice(deps, payload.consentId);
      if (!consent.ok) return consent;
      const deleted = await deps.consents.delete(payload.consentId);
      return deleted.ok ? ok({ result: null }) : deleted;
    },
  });

  const clone = defineCommand({
    name: VOICE_CONSENT_COMMANDS.createClone,
    payload: voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.createClone],
    sideEffect: 'external',
    ...person,
    handle: async (payload) => {
      const made = await createClone(deps, payload);
      if (!made.ok) return made;
      return ok({
        result: made.value,
        inverse: {
          name: VOICE_CONSENT_COMMANDS.deleteClone,
          payload: { projectId: null, consentId: payload.consentId },
        },
      });
    },
  });

  const unclone = defineCommand({
    name: VOICE_CONSENT_COMMANDS.deleteClone,
    payload: voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.deleteClone],
    sideEffect: 'destructive',
    ...person,
    handle: async (payload) => {
      const consent = await deleteProviderVoice(deps, payload.consentId);
      if (!consent.ok) return consent;
      if (!consent.value.clone) return ok({ result: null });
      const set = await deps.consents.setClone(payload.consentId, null);
      return set.ok ? ok({ result: null }) : set;
    },
  });

  return {
    recordConsent: record,
    withdrawConsent: withdraw,
    createClone: clone,
    deleteClone: unclone,
    all: [record, withdraw, clone, unclone] as const,
  };
}
