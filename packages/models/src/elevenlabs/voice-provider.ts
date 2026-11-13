// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's VoiceProvider on ElevenLabs (SPEC P3.2), composed from its parts: speech with character timings
 * (voice-synthesize.ts), the voice list (voice-list.ts) and own-voice clones (voice-clones.ts). The caller checks the
 * consent before createClone.
 */
import { readFile as readFileFromDisk } from 'node:fs/promises';
import type { GenerationAvailability, VoiceProvider } from '@taalcut/core';
import type { ModelSelector } from '../client/model-client';
import { accountAvailability } from './availability';
import type { PresenceDeps } from './c2pa';
import type { ElevenLabsSession } from './session';
import { createVoiceClone, deleteVoiceClone, type ReadFile } from './voice-clones';
import { listVoices } from './voice-list';
import { voiceChain } from './voice-models';
import { synthesizeLine } from './voice-synthesize';

export interface ElevenLabsVoiceDeps extends PresenceDeps {
  readonly session: ElevenLabsSession;
  /** The voice module's chain (the active profile). Absent: drafts on eleven_v4_turbo, finals on eleven_v4. */
  readonly selector?: ModelSelector;
  /** Reads a stored file (the consent recording); default node:fs. */
  readonly readFile?: ReadFile;
}

const readFromDisk: ReadFile = async (path) => new Uint8Array(await readFileFromDisk(path));

function voiceAvailability(deps: ElevenLabsVoiceDeps): GenerationAvailability {
  const account = accountAvailability(deps.session.http);
  if (!account.ok) return account;
  const chain = voiceChain(deps.selector);
  const none = !chain.ok || (chain.value !== null && chain.value.length === 0);
  return none ? { ok: false, reason: 'no_model' } : account;
}

export function createElevenLabsVoice(deps: ElevenLabsVoiceDeps): VoiceProvider {
  const { http } = deps.session;
  const readFile = deps.readFile ?? readFromDisk;
  return {
    available: () => voiceAvailability(deps),
    synthesize: (request) => synthesizeLine(deps, request),
    voices: (filter = {}) => listVoices(http, filter),
    createClone: (request) => createVoiceClone(http, readFile, request),
    deleteClone: (voiceId, signal) => deleteVoiceClone(http, voiceId, signal),
  };
}
