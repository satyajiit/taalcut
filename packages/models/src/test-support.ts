// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/models/test-support: local stand-ins for the providers and for
 * OpenAI's Sign in with ChatGPT, for tests and end-to-end tests only (Node;
 * app and package code never import it). The provider server streams each
 * provider's real wire format, so pi-ai's own provider code talks to it
 * through a base-URL override.
 */
export {
  startMockProviderServer,
  type MockProviderServer,
  type MockStep,
  type RecordedRequest,
  type Route,
} from './test-support/mock-provider-server';
export {
  ACCOUNT_EMAIL,
  createFakeBrowser,
  startMockOAuthServer,
  type IssuedTokens,
  type MockOAuthServer,
} from './test-support/mock-oauth-server';
export { DEFAULT_USAGE, type MockReply, type MockUsage } from './test-support/wire';
// P3-B10: every outbound connection attempt in a process, recorded; outside the allow list, refused.
export {
  LOOPBACK_HOSTS,
  NetworkBlockedError,
  recordNetwork,
  type NetworkApi,
  type NetworkAttempt,
  type NetworkRecorder,
  type NetworkRecorderOptions,
} from './testing/network-recorder';
export { isLoopbackHost } from './testing/network-targets';
