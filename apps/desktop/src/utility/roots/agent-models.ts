// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The model side of the agent process: the pi-ai runtime, credentials from
 * main's AuthBroker (cached here; main says when to forget them), the
 * ModelClient that logs every call to the library, the model profiles, and
 * the hardware tier they resolve against.
 */
import {
  callRpc,
  CloudCallSinkToken,
  componentInstallerOverRpc,
  ModelProfileStoreToken,
  ok,
  SettingsStoreToken,
  type CloudCallSink,
  type Container,
  type MainServicesClient,
} from '@taalcut/core';
import {
  createCachingCredentialProvider,
  createModelClient,
  createModelProfiles,
  createModelRuntime,
  createModelSettingsService,
  createPlanBilling,
  createStaticCredentialProvider,
  type CredentialProvider,
  type ModelClient,
  type ModelRuntime,
  type ModelRuntimeOptions,
} from '@taalcut/models';
import { syncLocalServers } from '../../shared/account-settings';
import {
  CredentialProviderToken,
  HardwareProbeToken,
  LocalRuntimeToken,
  ModelClientToken,
  ModelProfilesToken,
  ModelRuntimeToken,
  ModelSettingsToken,
  PlanBillingToken,
  UtilityConfigToken,
  type LocalRuntimeSlot,
  type ProbedHardware,
} from '../../shared/tokens';
import { registerImageProviders } from './agent-images';
import { LocalOnlyFlagToken } from './agent-flows';
import { macHardware } from './hardware';
import { createLocalRuntimeSlot, NO_INSTALLER } from './local-runtime';
import { componentsRoot } from './machine-accelerators';
import { modelClientLimits } from './agent-limits';

type Main = () => MainServicesClient<'agent'>;

/** Credentials for one request from main's AuthBroker. Secrets cross this port only, never to a page. */
export function credentialsFromMain(main: Main): CredentialProvider {
  return {
    async get(provider, request = {}) {
      const resolved = await callRpc(
        main().credentials.get(
          {
            provider,
            ...(request.minValidityMs !== undefined ? { minValidityMs: request.minValidityMs } : {}),
            ...(request.forceRefresh ? { forceRefresh: true } : {}),
          },
          request.signal ? { signal: request.signal } : {},
        ),
      );
      return resolved.ok ? ok(resolved.value ?? undefined) : resolved;
    },
    invalidate(provider) {
      void main()
        .credentials.invalidate({ provider })
        .catch(() => undefined);
    },
  };
}

export interface AgentModelsOptions {
  /** Main's services; absent in tests (no credentials then). */
  readonly main?: Main;
  /** Replaces the macOS probe (tests). */
  readonly hardware?: () => Promise<ProbedHardware>;
  /** Replaces the llama.cpp runtime (tests). */
  readonly localRuntime?: (runtime: ModelRuntime) => LocalRuntimeSlot;
  /** Replaces the ModelClient, given the library's call log (test builds: a recorded model session). */
  readonly modelClient?: (callLog: CloudCallSink) => ModelClient;
  /** Runtime options (test builds: providers at local mock servers). */
  readonly modelRuntime?: ModelRuntimeOptions;
}

export function registerAgentModels(container: Container, options: AgentModelsOptions): void {
  const main = options.main;
  container.factory(ModelRuntimeToken, () => createModelRuntime(options.modelRuntime));
  container.value(
    CredentialProviderToken,
    main
      ? createCachingCredentialProvider({ source: credentialsFromMain(main) })
      : {
          ...createStaticCredentialProvider({}),
          invalidate: () => undefined,
          forget: () => undefined,
          kindOf: () => undefined,
        },
  );
  // UX3-AGT: a ChatGPT (or other) plan's calls are priced at US$0 and count against no cap (createPlanBilling).
  container.factory(
    PlanBillingToken,
    ({ credentials }) =>
      createPlanBilling({
        credentials,
        configured: async () => {
          if (!main) return undefined;
          const configured = await callRpc(main().credentials.configured());
          return configured.ok ? new Set(configured.value) : undefined;
        },
      }),
    { deps: { credentials: CredentialProviderToken } },
  );
  container.factory(ModelProfilesToken, ({ store }) => createModelProfiles({ store }), {
    deps: { store: ModelProfileStoreToken },
  });
  const replaced = options.modelClient;
  container.factory(
    ModelClientToken,
    ({ runtime, credentials, callLog, profiles, local }) =>
      replaced?.(callLog) ??
      createModelClient({
        runtime,
        credentials,
        selector: profiles,
        callLog,
        // The embedded llama.cpp runtime: started for an on-device call and held until it ends.
        localLease: (provider, signal, model) => local.localLease(provider, signal, model),
        // G8: the limits calls meet, for Settings › Usage and the rateLimit card (agent-limits.ts).
        ...modelClientLimits(container),
        // Settings → Privacy → Local only: cloud calls are refused with core.local_only (agent-flows.ts).
        ...(container.has(LocalOnlyFlagToken)
          ? { localOnly: () => container.resolve(LocalOnlyFlagToken).get() }
          : {}),
      }),
    {
      deps: {
        runtime: ModelRuntimeToken,
        credentials: CredentialProviderToken,
        callLog: CloudCallSinkToken,
        profiles: ModelProfilesToken,
        local: LocalRuntimeToken,
      },
    },
  );
  // P3-B7: the image providers in route order, over the same keys and CloudCall log (agent-images.ts).
  registerImageProviders(container);
  container.factory(
    LocalRuntimeToken,
    ({ runtime, config }) =>
      options.localRuntime?.(runtime) ??
      createLocalRuntimeSlot({
        runtime,
        // Installs happen in the jobs process, the one manager of <userData>/components.
        installer: main ? componentInstallerOverRpc(() => main().components) : NO_INSTALLER,
        componentsRoot: componentsRoot(config.userData),
      }),
    { deps: { runtime: ModelRuntimeToken, config: UtilityConfigToken }, dispose: (slot) => slot.dispose() },
  );
  container.factory(
    ModelSettingsToken,
    ({ profiles, runtime, local }) =>
      createModelSettingsService({
        profiles,
        runtime,
        // The bundled runtime's downloaded weights: an on-device model without them is marked, not offered in chat.
        installedLocalModels: () => new Set(local.runtime()?.status().installedModels ?? []),
        // Main knows which providers have a key or sign-in; without it nothing is marked 'not-configured'.
        ...(main
          ? {
              configuredProviders: async () => {
                const configured = await callRpc(main().credentials.configured());
                return new Set(configured.ok ? configured.value : []);
              },
            }
          : {}),
      }),
    {
      deps: { profiles: ModelProfilesToken, runtime: ModelRuntimeToken, local: LocalRuntimeToken },
      dispose: (service) => service.dispose(),
    },
  );
  container.factory(HardwareProbeToken, ({ config }) => options.hardware ?? macHardware(config.userData), {
    deps: { config: UtilityConfigToken },
  });
}

/**
 * Loads the saved profiles and the user's own servers, then probes the
 * machine in the background (it takes a moment) and tells Settings → Models
 * (the profiles' tier and the recommended profile) and the local runtime.
 * A failed probe keeps the lowest tier.
 */
export async function startAgentModels(container: Container): Promise<void> {
  const profiles = container.resolve(ModelProfilesToken);
  void container.resolve(PlanBillingToken).refresh();
  const loaded = await profiles.load();
  if (!loaded.ok) console.warn(`[agent] model profiles: ${loaded.error.code}`);
  await syncLocalServers(container.resolve(ModelRuntimeToken), container.resolve(SettingsStoreToken));
  void container
    .resolve(HardwareProbeToken)()
    .then(
      (hardware) => {
        container.resolve(ModelSettingsToken).setHardware(hardware.assessment);
        container.resolve(LocalRuntimeToken).start(hardware.assessment);
      },
      (cause: unknown) => console.warn('[agent] hardware probe failed; using the lowest tier', cause),
    );
}
