// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The production account wiring in one process: a main-process runtime and
 * auth broker over a SecretStore, and an agent-process ModelClient whose
 * credentials come from the broker through the caching provider (in the app,
 * across IPC). Providers and OpenAI's OAuth endpoints are local mock servers.
 */
import {
  createAuthBroker,
  createCachingCredentialProvider,
  createMemoryCloudCallSink,
  createMemorySecretStore,
  createModelClient,
  createModelRuntime,
  type AcknowledgementStore,
  type ApiKeyTester,
  type AuthBroker,
  type CachingCredentialProvider,
  type ChatGPTSignInOptions,
  type MemoryCloudCallSink,
  type MemorySecretStore,
  type ModelClient,
  type ModelRuntime,
  type SignInEvent,
} from '@taalcut/models';
import { createFakeBrowser, startMockOAuthServer, type MockOAuthServer } from '@taalcut/models/test-support';
import { startMockProviderServer, type MockProviderServer } from '@taalcut/models/test-support';

export interface AccountsHarness {
  readonly oauth: MockOAuthServer;
  readonly provider: MockProviderServer;
  readonly browser: ReturnType<typeof createFakeBrowser>;
  readonly secrets: MemorySecretStore;
  readonly mainRuntime: ModelRuntime;
  readonly agentRuntime: ModelRuntime;
  readonly broker: AuthBroker;
  readonly cache: CachingCredentialProvider;
  readonly client: ModelClient;
  /** Calls made by the agent. */
  readonly callLog: MemoryCloudCallSink;
  /** Key-test calls made by the broker. */
  readonly keyTestLog: MemoryCloudCallSink;
  readonly events: SignInEvent[];
  close(): Promise<void>;
}

export interface AccountsOptions {
  readonly chatgpt?: ChatGPTSignInOptions;
  readonly acknowledgements?: AcknowledgementStore;
  readonly testApiKey?: ApiKeyTester;
  readonly openExternal?: (url: string) => void | Promise<void>;
  readonly signInTimeoutMs?: number;
}

export async function createAccountsHarness(options: AccountsOptions = {}): Promise<AccountsHarness> {
  const oauth = await startMockOAuthServer();
  const provider = await startMockProviderServer();
  const browser = createFakeBrowser();
  const secrets = createMemorySecretStore();
  const events: SignInEvent[] = [];
  const overrides = { openai: provider.openaiBaseUrl, anthropic: provider.anthropicBaseUrl };

  const mainRuntime = createModelRuntime({
    secrets,
    builtinProviders: ['openai', 'anthropic', 'github-copilot', 'xai'],
    baseUrlOverrides: overrides,
    signIn: {
      chatgpt: {
        authorizeUrl: oauth.authorizeUrl,
        tokenUrl: oauth.tokenUrl,
        callbackPort: 0,
        ...options.chatgpt,
      },
    },
  });
  const keyTestLog = createMemoryCloudCallSink();
  const broker = createAuthBroker({
    runtime: mainRuntime,
    openExternal: options.openExternal ?? browser.open,
    onSignInEvent: (event) => events.push(event),
    callLog: keyTestLog,
    ...(options.acknowledgements ? { acknowledgements: options.acknowledgements } : {}),
    ...(options.testApiKey ? { testApiKey: options.testApiKey } : {}),
    ...(options.signInTimeoutMs ? { signInTimeoutMs: options.signInTimeoutMs } : {}),
  });

  const agentRuntime = createModelRuntime({ baseUrlOverrides: overrides });
  const cache = createCachingCredentialProvider({ source: broker });
  // In the app this event crosses IPC to the agent process.
  broker.onChange((id) => cache.forget(id));
  const callLog = createMemoryCloudCallSink();
  const client = createModelClient({
    runtime: agentRuntime,
    credentials: cache,
    callLog,
    retry: { maxRetries: 0 },
  });

  return {
    oauth,
    provider,
    browser,
    secrets,
    mainRuntime,
    agentRuntime,
    broker,
    cache,
    client,
    callLog,
    keyTestLog,
    events,
    close: async () => {
      await Promise.all([oauth.close(), provider.close()]);
    },
  };
}
