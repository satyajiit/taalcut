// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Styles (P3-V10) and the hub client (P3-B12, P3-V8) in the agent process.
 * Reads and commands run only when the library has registered the stores.
 * Until then each procedure returns core.not_implemented — the routers are
 * real, and nothing is stored in memory in their place. This install's own
 * star ratings are a setting. The hub's service is built once
 * (agent-hub-client.ts) and shared with the hub tools (agent-hub-tools.ts).
 */
import {
  AcknowledgementStoreToken,
  ClockToken,
  CommandBusToken,
  err,
  hubRouter,
  NotImplementedError,
  SettingsStoreToken,
  StyleStoreToken,
  stylesRouter,
  type Container,
  type HubService,
  type StylesService,
} from '@taalcut/core';
import {
  createHubCommands,
  createStyleCommands,
  createStyleService,
  nodeImageReader,
} from '@taalcut/templates';
import { hubClientOf, hubIds, type HubClient } from './agent-hub-client';
import { LIBRARY_STORE_KEEPS_METADATA } from './agent-templates';

export { HubInstallKeyToken } from './agent-hub-client';

function missingStyles(): StylesService {
  const unavailable = async () => err(NotImplementedError({ feature: 'styles' }));
  return { list: unavailable, get: unavailable, usedBy: unavailable, importImage: unavailable };
}

function missingHub(): HubService {
  const unavailable = async () => err(NotImplementedError({ feature: 'hub' }));
  return {
    status: unavailable,
    browse: unavailable,
    get: unavailable,
    shareCheck: unavailable,
    submissions: unavailable,
  };
}

function styles(container: Container) {
  if (!container.has(StyleStoreToken)) return stylesRouter(missingStyles());
  const store = container.resolve(StyleStoreToken);
  const settings = container.has(SettingsStoreToken) ? container.resolve(SettingsStoreToken) : undefined;
  if (settings && container.has(ClockToken) && container.has(CommandBusToken)) {
    container
      .resolve(CommandBusToken)
      .register(...createStyleCommands({ store, settings, clock: container.resolve(ClockToken) }).all);
  }
  return stylesRouter(
    createStyleService({ store, readFile: nodeImageReader(), ...(settings ? { settings } : {}) }),
  );
}

function hub(container: Container) {
  const client = hubClientOf(container);
  if (!client) return hubRouter(missingHub());
  registerHubCommands(container, client);
  return hubRouter(client.service);
}

function registerHubCommands(container: Container, client: HubClient): void {
  if (!container.has(CommandBusToken) || !container.has(AcknowledgementStoreToken)) return;
  container.resolve(CommandBusToken).register(
    ...createHubCommands({
      service: client.service,
      transport: client.transport,
      index: client.index,
      store: client.store,
      submissions: client.submissions,
      acknowledgements: container.resolve(AcknowledgementStoreToken),
      settings: client.settings,
      myRatings: client.myRatings,
      clock: container.resolve(ClockToken),
      ids: hubIds(),
      // A fork must not lose its hub id and CC0 licence: core.not_implemented until the store keeps provenance.
      libraryMetadata: LIBRARY_STORE_KEEPS_METADATA,
      openShare: client.openShare,
    }).all,
  );
}

/** `styles` and `hub` for appContract. mcp and mcpGateway stay with mcp-release. */
export function templatesHubRouters(container: Container) {
  return { styles: styles(container), hub: hub(container) };
}
