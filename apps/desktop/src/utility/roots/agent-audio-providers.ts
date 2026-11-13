// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The providers behind audio's Phase 3 in the agent process (packages/models SPEC P3.8): one ElevenLabs session
 * (the key from main's keychain through the cached credential provider, a CloudCall row per request, Local only
 * read on every call) for core's VoiceProvider, MusicProvider and SfxProvider, and the caption TextTranslator over
 * the agent chain.
 */
import {
  CloudCallSinkToken,
  ContentCredentialsToken,
  createToken,
  MusicProviderToken,
  SfxProviderToken,
  TextTranslatorToken,
  VoiceProviderToken,
  type Container,
} from '@taalcut/core';
import {
  createElevenLabsMusic,
  createElevenLabsSession,
  createElevenLabsSfx,
  createElevenLabsVoice,
  createTextTranslator,
  ELEVENLABS_PROVIDER,
  type ElevenLabsSession,
} from '@taalcut/models';
import {
  CredentialProviderToken,
  ModelClientToken,
  ModelProfilesToken,
  ModelRuntimeToken,
} from '../../shared/tokens';
import { LocalOnlyFlagToken } from './agent-flows';

export const ElevenLabsSessionToken = createToken<ElevenLabsSession>('agent.elevenLabsSession');

/** Refuses until the setting is read (agent-flows.ts): nothing leaves before Local only is known. */
const localOnly = (container: Container) => () =>
  !container.has(LocalOnlyFlagToken) || container.resolve(LocalOnlyFlagToken).get();

/** Learns whether an ElevenLabs key is set, so `available()` can say `not_configured` before any call. */
function checkKey(session: ElevenLabsSession): void {
  void session.http.checkKey().then((state) => {
    if (!state.ok) console.warn(`[agent] ElevenLabs key not checked: ${state.error.code}`);
  });
}

const credentialsOf = (container: Container) =>
  container.has(ContentCredentialsToken)
    ? { contentCredentials: container.resolve(ContentCredentialsToken) }
    : {};

export function registerAudioProviders(container: Container): void {
  container.factory(
    ElevenLabsSessionToken,
    ({ credentials, callLog }) => {
      const session = createElevenLabsSession({ credentials, callLog, localOnly: localOnly(container) });
      checkKey(session);
      return session;
    },
    { deps: { credentials: CredentialProviderToken, callLog: CloudCallSinkToken } },
  );
  container.factory(
    VoiceProviderToken,
    ({ session, selector }) => createElevenLabsVoice({ session, selector, ...credentialsOf(container) }),
    { deps: { session: ElevenLabsSessionToken, selector: ModelProfilesToken } },
  );
  container.factory(
    MusicProviderToken,
    ({ session }) => createElevenLabsMusic({ session, ...credentialsOf(container) }),
    { deps: { session: ElevenLabsSessionToken } },
  );
  container.factory(
    SfxProviderToken,
    ({ session }) => createElevenLabsSfx({ session, ...credentialsOf(container) }),
    { deps: { session: ElevenLabsSessionToken } },
  );
  container.factory(
    TextTranslatorToken,
    ({ client, selector, runtime }) =>
      createTextTranslator({ client, selector, runtime, localOnly: localOnly(container) }),
    { deps: { client: ModelClientToken, selector: ModelProfilesToken, runtime: ModelRuntimeToken } },
  );
}

/** A key added, changed or removed in Settings → Accounts: check ElevenLabs' again (agent-root.ts). */
export function audioCredentialsChanged(container: Container, provider: string): void {
  if (provider === ELEVENLABS_PROVIDER && container.has(ElevenLabsSessionToken))
    checkKey(container.resolve(ElevenLabsSessionToken));
}
