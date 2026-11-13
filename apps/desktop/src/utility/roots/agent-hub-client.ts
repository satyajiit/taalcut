// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hub client in the agent process (P3-B12, P3-V8): one transport, index client and service, built once the
 * library has registered the hub stores, shared by the `hub` router, the hub commands and the agent's hub tools.
 * Absent stores mean no client: the router answers core.not_implemented and the tools are not offered.
 */
import {
  ClockToken,
  createToken,
  err,
  EventBusToken,
  HubIndexCacheToken,
  HubSubmissionStoreToken,
  newId,
  NotFoundError,
  NotImplementedError,
  ok,
  SettingsStoreToken,
  StyleStoreToken,
  TemplateStoreToken,
  type AsyncResult,
  type Container,
  type HubService,
  type HubSubmissionStore,
  type SettingsStore,
  type StyleId,
  type TemplateId,
  type TemplateStore,
} from '@taalcut/core';
import {
  createFetchHubTransport,
  createHubIndexClient,
  createHubService,
  createSettingsMyRatings,
  createTemplateService,
  type HubIndexClient,
  type HubTransport,
  type MyRatings,
} from '@taalcut/templates';
import { UtilityConfigToken } from '../../shared/tokens';
import { LocalOnlyFlagToken } from './agent-flows';
import { hubEndpoints } from './hub-endpoints';

/**
 * The `taalcut-hub` keychain item (the install key), read through main: the key never reaches a window, a log or
 * an error. mcp-release registers it; absent, every hub write is core.not_implemented.
 */
export const HubInstallKeyToken = createToken<() => AsyncResult<string>>('desktop.hubInstallKey');

export interface HubClient {
  readonly service: HubService;
  readonly transport: HubTransport;
  readonly index: HubIndexClient;
  readonly store: TemplateStore;
  readonly submissions: HubSubmissionStore;
  readonly settings: SettingsStore;
  readonly myRatings: MyRatings;
  /** Asks the window to open the Share card (`ui.action` `hub.openShare`). */
  readonly openShare: (templateId: TemplateId, version: number | undefined) => void;
}

const HubClientToken = createToken<HubClient>('desktop.hubClient');

export function hubIds() {
  return {
    template: () => newId<'Template'>(),
    slot: () => newId<'TemplateSlot'>(),
    overlay: () => newId<'TextOverlay'>(),
  };
}

/** What the client needs from the container; the stores are the library's (absent until it registers them). */
function isReady(container: Container): boolean {
  return (
    container.has(HubIndexCacheToken) &&
    container.has(HubSubmissionStoreToken) &&
    container.has(TemplateStoreToken) &&
    container.has(SettingsStoreToken) &&
    container.has(ClockToken) &&
    container.has(EventBusToken)
  );
}

function buildClient(container: Container): HubClient {
  const clock = container.resolve(ClockToken);
  const settings = container.resolve(SettingsStoreToken);
  const store = container.resolve(TemplateStoreToken);
  const submissions = container.resolve(HubSubmissionStoreToken);
  const events = container.resolve(EventBusToken);
  const packaged = container.has(UtilityConfigToken) && container.resolve(UtilityConfigToken).packaged;
  const endpoints = hubEndpoints(packaged);
  // Refuses until the setting is read (agent-flows.ts): nothing leaves before Local only is known.
  const localOnly = () =>
    container.has(LocalOnlyFlagToken) ? container.resolve(LocalOnlyFlagToken).get() : true;
  const transport = createFetchHubTransport({
    endpoints,
    fetch: globalThis.fetch,
    localOnly,
    installKey: async () =>
      container.has(HubInstallKeyToken)
        ? container.resolve(HubInstallKeyToken)()
        : err(NotImplementedError({ feature: 'hub.installKey' })),
  });
  const index = createHubIndexClient({ cache: container.resolve(HubIndexCacheToken), transport, clock });
  const myRatings = createSettingsMyRatings(settings);
  const styleStore = container.has(StyleStoreToken) ? container.resolve(StyleStoreToken) : undefined;
  const service = createHubService({
    endpoints,
    localOnly,
    transport,
    index,
    templates: createTemplateService({ store, clock }),
    submissions,
    clock,
    ids: hubIds(),
    newHubTemplateId: () => newId<'HubTemplate'>(),
    myRatings,
    ...(styleStore
      ? {
          styleOf: async (styleId: StyleId) => {
            const found = await styleStore.get(styleId);
            if (found.ok) return found;
            return NotFoundError.is(found.error) ? ok(null) : found;
          },
        }
      : {}),
  });
  const openShare = (templateId: TemplateId, version: number | undefined) => {
    events.emit('ui.action', {
      action: 'hub.openShare',
      args: { templateId, ...(version === undefined ? {} : { version: String(version) }) },
    });
  };
  return { service, transport, index, store, submissions, settings, myRatings, openShare };
}

/** The one hub client of this process, or null while the library hasn't registered the hub stores. */
export function hubClientOf(container: Container): HubClient | null {
  if (container.has(HubClientToken)) return container.resolve(HubClientToken);
  if (!isReady(container)) return null;
  container.factory(HubClientToken, () => buildClient(container));
  return container.resolve(HubClientToken);
}
