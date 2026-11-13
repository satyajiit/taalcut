// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hub client (P3-B12, P3-V8): the transport, the index client, the service appContract.hub serves, the commands
 * and the tools. In-memory stores for tests are in `testing/memory-hub-stores`.
 */
export { hubTemplateFileUrl, hubWorkerUrl, type HubEndpoints } from './endpoints';
export { createFetchHubTransport, type FetchHubTransportOptions } from './fetch-transport';
export { fromHubTemplate, type HubIds } from './from-hub';
export { createHubCommands, requestOpenShare, type HubCommandDeps } from './hub-commands';
export { createHubService, type HubServiceDeps } from './hub-service';
export { hubToolModule, type HubToolDeps } from './hub-tools';
export { type HubTransport } from './hub-transport';
export { createHubIndexClient, HUB_INDEX_TTL_MS, type CachedIndex, type HubIndexClient } from './index-cache';
export { createSettingsMyRatings, HUB_MY_RATINGS_SETTING, type MyRatings } from './my-ratings';
export { placeholderFor, textMeasure, type HubTextRole } from './overlay-placeholders';
export { readHubDocument, type VerifiedTemplate } from './read-document';
export { shareCheck, type ShareCheckInput } from './share-check';
export { hubDraft, toHubTemplate, type HubTemplateMeta } from './to-hub';
