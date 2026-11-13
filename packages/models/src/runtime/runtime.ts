// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pi-ai `Models` collection behind ModelClient: every built-in provider,
 * plus local OpenAI-compatible endpoints, plus base-URL overrides for proxies
 * and test servers. Ambient credentials are sealed off: pi-ai never reads
 * OPENAI_API_KEY and friends from the environment, so every secret comes from
 * the CredentialProvider (or, in the main process, the SecretStore).
 */
import {
  createModels,
  InMemoryCredentialStore,
  isModelType,
  type AnyModel,
  type Api,
  type AuthContext,
  type ClassifierApi,
  type ClassifierModel,
  type CredentialStore,
  type Model,
  type MutableModels,
  type Provider,
} from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { CHATGPT_IMAGE_PROVIDER, err, ok, type Result } from '@taalcut/core';
import { secretCredentialStore, type SecretStore } from '../credentials/secret-store';
import type { ComputeBackend } from '../hardware/compute';
import { EndpointInvalid } from '../errors';
import { createChatGPTOAuth, type ChatGPTSignInOptions } from '../signin/chatgpt';
import { createCodexImagesAuthProvider } from '../signin/codex-images';
import { thinkingLevels } from '../client/thinking';
import { LOCAL_RUNTIME_PROVIDER } from '../local-runtime/types';
import type { ReasoningLevel } from '../modules';
import { isLocalEndpoint, localEndpointProvider, localModel, type LocalEndpoint } from './endpoints';

export interface ModelRuntimeOptions {
  /** Local servers to register as providers (Ollama, LM Studio). */
  readonly endpoints?: readonly LocalEndpoint[];
  /** Provider id → base URL, for proxies and test servers that speak the provider's wire format. */
  readonly baseUrlOverrides?: Readonly<Record<string, string>>;
  /** Main process only: where pi-ai keeps keys and OAuth credentials, refresh tokens included. */
  readonly secrets?: SecretStore;
  /** Register only these built-in pi-ai providers. Default: all of them. */
  readonly builtinProviders?: readonly string[];
  /** Sign-in settings; only tests change them (a mock OAuth server). */
  readonly signIn?: { readonly chatgpt?: ChatGPTSignInOptions };
}

export type ModelInfoKind = 'chat' | 'image' | 'classifier';

/** What Taalcut needs to know about a model, without pi-ai's types. Prices are USD per million tokens. */
export interface ModelInfo {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly kind: ModelInfoKind;
  readonly reasoning: boolean;
  /** Chat models: the reasoning levels it takes, lightest first (client/thinking.ts). */
  readonly thinking?: readonly ReasoningLevel[];
  readonly input: readonly ('text' | 'image')[];
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly price: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  readonly local: boolean;
  /** For local endpoints that declare it: where the server runs models (ADR 0002). */
  readonly compute?: readonly ComputeBackend[];
  readonly baseUrl: string;
}

export interface ModelRuntime {
  /** Looks a model up by id; pass `kind` when one id has entries for several operations. */
  findModel(provider: string, model: string, kind?: ModelInfoKind): ModelInfo | undefined;
  listModels(provider?: string): readonly ModelInfo[];
  hasProvider(provider: string): boolean;
  isLocalProvider(provider: string): boolean;
  /** Adds or replaces a local endpoint (P1-F4). The next call sees it. */
  setEndpoint(endpoint: LocalEndpoint): Result<void>;
  removeEndpoint(id: string): void;
  listEndpoints(): readonly LocalEndpoint[];
}

/** Package-internal view of a runtime: the pi-ai pieces ModelClient and the auth broker use. */
export interface RuntimeInternals {
  readonly models: MutableModels;
  /** The store pi-ai resolves stored credentials from (the SecretStore in the main process). */
  readonly credentials: CredentialStore;
  readonly secrets?: SecretStore;
  chatModel(provider: string, model: string): Model<Api> | undefined;
  /** The key a local endpoint requires (the embedded runtime's per-launch key), if any. */
  endpointKey(provider: string): string | undefined;
  classifierModel(provider: string, model: string): ClassifierModel<ClassifierApi> | undefined;
}

const internals = new WeakMap<ModelRuntime, RuntimeInternals>();

export function runtimeInternals(runtime: ModelRuntime): RuntimeInternals {
  const found = internals.get(runtime);
  if (!found) throw new Error('Not a runtime made by createModelRuntime().');
  return found;
}

/** Ambient auth is off: no env vars, no credential files (e.g. ~/.aws). */
const SEALED_AUTH_CONTEXT: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

export function createModelRuntime(options: ModelRuntimeOptions = {}): ModelRuntime {
  const credentials = options.secrets
    ? secretCredentialStore(options.secrets)
    : new InMemoryCredentialStore();
  const models = createModels({ authContext: SEALED_AUTH_CONTEXT, credentials });
  const wanted = options.builtinProviders ? new Set(options.builtinProviders) : undefined;
  const builtinIds = new Set<string>();
  for (const provider of builtinProviders()) {
    builtinIds.add(provider.id);
    if (!wanted || wanted.has(provider.id)) models.setProvider(withOwnSignIn(provider, options));
  }
  builtinIds.add(CHATGPT_IMAGE_PROVIDER);
  if (!wanted || wanted.has(CHATGPT_IMAGE_PROVIDER)) models.setProvider(createCodexImagesAuthProvider());
  const endpoints = new Map<string, LocalEndpoint>();
  const setEndpoint = (endpoint: LocalEndpoint): Result<void> => {
    // A local endpoint must not shadow a cloud provider: its calls would be logged as local.
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(endpoint.id) || builtinIds.has(endpoint.id))
      return err(EndpointInvalid({ field: 'id' }));
    if (!/^https?:$/.test(protocolOf(endpoint.baseUrl))) return err(EndpointInvalid({ field: 'baseUrl' }));
    endpoints.set(endpoint.id, endpoint);
    models.setProvider(localEndpointProvider(endpoint));
    return ok(undefined);
  };
  for (const endpoint of options.endpoints ?? []) {
    const added = setEndpoint(endpoint);
    if (!added.ok) throw new Error(`Invalid local endpoint "${endpoint.id}": ${added.error.code}`);
  }
  const overrides = options.baseUrlOverrides ?? {};

  const withOverride = <M extends AnyModel>(model: M): M => {
    const baseUrl = overrides[model.provider];
    return baseUrl ? { ...model, baseUrl } : model;
  };

  const chatModel = (provider: string, id: string): Model<Api> | undefined => {
    const known = models.getModel(provider, id);
    if (known) return withOverride(known);
    const endpoint = endpoints.get(provider);
    if (endpoint?.acceptUnlisted) return withOverride(localModel(endpoint, { id }));
    return undefined;
  };

  const classifierModel = (provider: string, id: string): ClassifierModel<ClassifierApi> | undefined => {
    const found = models.getAllModels(provider).find((m) => m.id === id);
    return found && isModelType(found, 'classifier') ? withOverride(found) : undefined;
  };

  // The bundled runtime is local even while it is stopped and its endpoint is gone: what counts as
  // a cloud provider (upload consent, the cloud-call log) must not change as it starts and stops.
  const isLocalProvider = (provider: string): boolean => {
    if (provider === LOCAL_RUNTIME_PROVIDER) return true;
    const endpoint = endpoints.get(provider);
    return endpoint ? isLocalEndpoint(endpoint) : false;
  };

  const toInfo = (model: AnyModel): ModelInfo => {
    const kind: ModelInfoKind = isModelType(model, 'image')
      ? 'image'
      : isModelType(model, 'classifier')
        ? 'classifier'
        : 'chat';
    const chat = isModelType(model, 'chat') ? model : undefined;
    const contextWindow =
      chat?.contextWindow ?? (isModelType(model, 'classifier') ? model.contextWindow : undefined);
    return {
      provider: model.provider,
      id: model.id,
      name: model.name,
      kind,
      reasoning: chat?.reasoning ?? false,
      ...(chat ? { thinking: thinkingLevels(chat) } : {}),
      input: model.input,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(chat ? { maxTokens: chat.maxTokens } : {}),
      price: {
        input: model.cost.input,
        output: model.cost.output,
        cacheRead: model.cost.cacheRead,
        cacheWrite: model.cost.cacheWrite,
      },
      local: isLocalProvider(model.provider),
      ...(endpoints.get(model.provider)?.compute ? { compute: endpoints.get(model.provider)?.compute } : {}),
      baseUrl: model.baseUrl,
    };
  };

  const runtime: ModelRuntime = {
    findModel(provider, id, kind) {
      const chat = kind === undefined || kind === 'chat' ? chatModel(provider, id) : undefined;
      if (chat) return toInfo(chat);
      // One upstream model can have separate entries per operation (OpenRouter lists some as chat and image).
      const other = models
        .getAllModels(provider)
        .map(toInfo)
        .find((m) => m.id === id && (kind === undefined || m.kind === kind));
      return other ? { ...other, baseUrl: overrides[provider] ?? other.baseUrl } : undefined;
    },
    listModels(provider) {
      return models.getAllModels(provider).map((m) => toInfo(withOverride(m)));
    },
    hasProvider: (provider) => models.getProvider(provider) !== undefined,
    isLocalProvider,
    setEndpoint,
    removeEndpoint(id) {
      if (endpoints.delete(id)) models.deleteProvider(id);
    },
    // The embedded runtime's key stays inside this process: settings and the renderer don't need it.
    listEndpoints: () => [...endpoints.values()].map(({ apiKey: _key, ...endpoint }) => endpoint),
  };
  internals.set(runtime, {
    models,
    credentials,
    chatModel,
    endpointKey: (provider) => endpoints.get(provider)?.apiKey,
    classifierModel,
    ...(options.secrets ? { secrets: options.secrets } : {}),
  });
  return runtime;
}

/** OpenAI's ChatGPT sign-in runs on Taalcut's copy of pi-ai's flow (signin/chatgpt.ts). */
function withOwnSignIn(provider: Provider, options: ModelRuntimeOptions): Provider {
  if (provider.id !== 'openai' || !provider.auth.oauth) return provider;
  // createProvider's methods are closures, not `this` methods, so a shallow copy keeps them working.
  return { ...provider, auth: { ...provider.auth, oauth: createChatGPTOAuth(options.signIn?.chatgpt) } };
}

function protocolOf(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}
