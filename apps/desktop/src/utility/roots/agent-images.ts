// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Image generation in the agent process (P3-B7, packages/models SPEC P3.3): the image providers in route
 * order over the user's API keys (from main's keychain through the cached credential provider), their
 * CloudCall rows in the library's log, Local only read on every call, each still's C2PA presence read from its
 * bytes (core's ContentCredentials, when this process has it); and the `images` tool module once the
 * library can keep generated files (GeneratedAssetSinkToken, vision-library lane) and timelines are stored.
 */
import {
  CloudCallSinkToken,
  ContentCredentialsToken,
  GeneratedAssetSinkToken,
  TimelineStoreToken,
  type Container,
  type ToolModule,
} from '@taalcut/core';
import {
  createImageProviders,
  imageC2paReader,
  ImageProvidersToken,
  imageToolModule,
  type ImageC2paReader,
} from '@taalcut/models';
import { CredentialProviderToken, ModelProfilesToken } from '../../shared/tokens';
import { LocalOnlyFlagToken } from './agent-flows';

/** A still's C2PA presence, read from its bytes before the library stores it (render-phase3-agent.ts). */
export function stillCredentials(container: Container): { contentCredentials?: ImageC2paReader } {
  if (!container.has(ContentCredentialsToken)) return {};
  return { contentCredentials: imageC2paReader(container.resolve(ContentCredentialsToken)) };
}

export function registerImageProviders(container: Container): void {
  container.factory(
    ImageProvidersToken,
    ({ credentials, callLog }) =>
      createImageProviders({
        credentials,
        callLog,
        // Refuses until the setting is read (agent-flows.ts): nothing leaves before Local only is known.
        localOnly: () => !container.has(LocalOnlyFlagToken) || container.resolve(LocalOnlyFlagToken).get(),
        ...stillCredentials(container),
      }),
    { deps: { credentials: CredentialProviderToken, callLog: CloudCallSinkToken } },
  );
}

/** `images.generateForSlot`, when this process can store what it makes. */
export function imageToolModules(container: Container): ToolModule[] {
  if (
    !container.has(ImageProvidersToken) ||
    !container.has(GeneratedAssetSinkToken) ||
    !container.has(TimelineStoreToken)
  )
    return [];
  return [
    imageToolModule({
      providers: container.resolve(ImageProvidersToken),
      selector: container.resolve(ModelProfilesToken),
      sink: container.resolve(GeneratedAssetSinkToken),
      timelines: container.resolve(TimelineStoreToken),
    }),
  ];
}
