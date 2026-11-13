// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/models: pi-ai setup, provider and auth registry, per-module model
 * profiles, hardware tiers. The only package allowed to import pi-ai or a
 * provider SDK (PRD R26). See SPEC.md.
 *
 * This file is the package's only public entry point. Other packages import
 * from '@taalcut/models' and never from a path inside src/. No pi-ai type is
 * exported: callers see Taalcut's own types only.
 */
export * from './errors';
export * from './modules';
export { scrubSecrets, scrubUrl, REDACTED } from './scrub';

export type {
  CallUsage,
  ModelClient,
  ModelEvent,
  ModelRequest,
  ModelResult,
  ModelStream,
  StopReason,
} from './client/types';
export {
  ChatMessageSchema,
  ContentPartSchema,
  ToolCallSchema,
  type AssistantChatMessage,
  type AssistantPart,
  type ChatMessage,
  type ContentPart,
  type ToolCall,
} from './client/messages';
export { parseToolCall, toolJsonSchema, type ToolSpec } from './client/tools';
export { ON_DEVICE_THINKING, reasoningForEffort, thinkingLevels } from './client/thinking';
export {
  canFallBack,
  createModelClient,
  type ModelClientDeps,
  type ModelSelector,
  type ResolvedChain,
} from './client/model-client';
export type { FetchFn } from './client/http-meter';
export { createBackgroundModels, type BackgroundModelsDeps } from './client/background-models';

// CloudCallRecord and CloudCallSink are core's (ports/model-ports).
export { createMemoryCloudCallSink, type MemoryCloudCallSink } from './calls/cloud-call';

// ElevenLabs & Resemble Chatterbox behind core's VoiceProvider, MusicProvider and SfxProvider (P3-B6, P3-V6, WP-VO-LOCAL),
// and caption translation behind core's TextTranslator (P3-V20).
export * from './elevenlabs';
export * from './chatterbox';
export { createTextTranslator, type TextTranslatorDeps } from './translate/text-translator';
export { TranslationInvalid } from './translate/errors';

export {
  createCachingCredentialProvider,
  createStaticCredentialProvider,
  type CachingCredentialProvider,
  type CachingCredentialProviderDeps,
  type CredentialProvider,
  type CredentialRequest,
  type ResolvedCredential,
} from './credentials/credential-provider';

// Accounts: sign-in, API keys, secrets (P1-F3, P1-F4, P1-F6). Main process only.
export {
  createAuthBroker,
  type AccountStatus,
  type AuthBroker,
  type AuthBrokerDeps,
} from './credentials/auth-broker';
export { createKeyTester, type ApiKeyTester, type KeyTesterDeps } from './credentials/api-keys';
export {
  createMemorySecretStore,
  type MemorySecretStore,
  type SecretStore,
} from './credentials/secret-store';
export { CHATGPT_SIGN_IN, type ChatGPTSignInOptions } from './signin/chatgpt';
export * from './client/chatgpt-plan-models'; // the ChatGPT plan's models and each role's (UX3-AGT)
export * from './signin/loopback'; // the sign-in's loopback server and its pages (UX3-AGT)
export {
  createMemoryAcknowledgementStore,
  SIGN_IN_OPTIONS,
  signInOption,
  type AcknowledgementStore,
  type MemoryAcknowledgementStore,
  type SignInOption,
  type WarningCard,
} from './signin/options';
export type { SignInEvent, SignInRequest } from './signin/sign-in';
export { MODELS_MESSAGES_EN } from './i18n/messages-en';

export {
  createModelRuntime,
  type ModelInfo,
  type ModelInfoKind,
  type ModelRuntime,
  type ModelRuntimeOptions,
} from './runtime/runtime';
export {
  isLoopbackUrl,
  LM_STUDIO_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_BASE_URL,
  type LocalEndpoint,
  type LocalModelSpec,
} from './runtime/endpoints';
export { discoverLocalModels, type DiscoverOptions, type LocalServerKind } from './runtime/discovery';

// Embedded local runtime (D16): a llama.cpp llama-server sidecar since spike 08 (provisional).
export {
  LOCAL_RUNTIME_PROVIDER,
  type ComponentInstaller,
  type InstalledComponentRef,
  type LaunchGpu,
  type LaunchInput,
  type LaunchModel,
  type LaunchRuntime,
  type LoadedLocalModel,
  type LocalRuntime,
  type LocalRuntimeDriver,
  type LocalRuntimeEndpoint,
  type LocalRuntimeLogEvent,
  type LocalRuntimeModel,
  type LocalRuntimeSpec,
  type LocalRuntimeState,
  type LocalRuntimeStatus,
  type RunningLocalRuntime,
} from './local-runtime/types';
export { createLocalRuntime, type LocalRuntimeDeps } from './local-runtime/supervisor';
export { componentsFor } from './local-runtime/components';
export {
  createLocalRuntimeManager,
  type LocalRuntimeLease,
  type LocalRuntimeManager,
  type LocalRuntimeManagerDeps,
} from './local-runtime/manager';
export {
  createLlamaServerDriver,
  IMAGE_MIN_TOKENS,
  llamaServerArgs,
  type LlamaServerArgsInput,
  type LlamaServerDriverDeps,
  type SidecarExit,
  type SidecarProcess,
  type SpawnPort,
  type SpawnRequest,
} from './local-runtime/llama-server';
export * from './local-runtime/mlx-server'; // MLX1: Taalcut's MLX server for Apple silicon (native/mlx-server)
export * from './local-runtime/engines'; // one driver over each engine's
export * from './local-runtime/mlx-spec'; // the 9B on MLX, and the spec each machine runs
export { attachLocalRuntime, localRuntimeEndpoint, type AttachedLocalRuntime } from './local-runtime/attach';
export {
  contextWindowFor,
  LLAMA_CPP_BUILDS,
  LLAMA_CPP_COMPUTE,
  LLAMA_CPP_MODELS,
  LLAMA_CPP_RUNTIME_NAME,
  llamaCppRuntimeSpec,
  KV_CACHE_TYPE,
  localModelBudgetBytes,
  MEASURED_EMBEDDER_BYTES,
  MEASURED_PEAK_BYTES,
  RECOMMENDED_SHARE_SIDECAR_BYTES,
  MAX_LOCAL_SLOTS,
  SMALLEST_LOCAL_WINDOW,
  VRAM_RESERVE_BYTES,
  vramSlots,
  type LlamaSlots,
} from './local-runtime/llama-cpp-spec';

// Router (P3-B11): the classifier over the router chain, the on-device rules router, router prices.
export {
  createClassifier,
  ROUTER_CLASSIFIER_CHAIN,
  type Classifier,
  type ClassifierAnswer,
  type ClassifierDeps,
  type ClassifierQuestion,
  type ClassifyRequest,
  type ClassifyResult,
} from './classify/classifier';
export { RULES_ROUTER, RULES_ROUTER_CONFIG, rulesClassify } from './classify/rules-classifier';
export {
  CLEF_FLASH_MAX_STATE_TOKENS,
  ROUTER_PRICES,
  routerPrice,
  type RouterPrice,
} from './classify/router-prices';

// Model registry and profiles (P1-F2).
export {
  createCatalog,
  daysUntil,
  isRetired,
  MODEL_CATALOG,
  type Catalog,
  type CatalogEntry,
} from './registry/catalog';
export * from './registry/current-models'; // each provider's current models, by role (UX3-AGT)
export {
  BUILTIN_PROFILE_IDS,
  DEFAULT_PROFILE_ID,
  defaultProfileState,
  MigrationRecordSchema,
  ModelProfileSchema,
  ModuleOverrideSchema,
  ModuleSettingSchema,
  ProfileStateSchema,
  type BuiltinProfileId,
  type MigrationRecord,
  type ModelProfile,
  type ModuleOverride,
  type ModuleSetting,
  type ProfileState,
} from './registry/profile-schema';
export { BUILTIN_PROFILES } from './registry/builtin-profiles';
export { createMemoryProfileStore, type MemoryProfileStore } from './registry/profile-store';
export {
  applyOverride,
  resolveModule,
  type EffectiveModule,
  type ResolveContext,
  type SkippedChoice,
} from './registry/resolve';
export {
  findRetirements,
  migrateRetiring,
  type MigrateOptions,
  type RetirementNotice,
  type WatchOptions,
} from './registry/deprecation';
export {
  createModelProfiles,
  type LoadOutcome,
  type ModelProfiles,
  type ModelProfilesDeps,
  type ProfileSelection,
} from './registry/profiles';

// DI tokens for the composition roots (core SPEC section 4).
export {
  CredentialProviderToken,
  HardwareProbeToken,
  ImageProvidersToken,
  LocalRuntimeToken,
  ModelClientToken,
  ModelProfilesToken,
  ModelRuntimeToken,
  ModelSettingsToken,
  PlanBillingToken,
  UsageLimitsTrackerToken,
  type LocalRuntimeSlot,
  type ProbedHardware,
} from './tokens';

// Usage limits (G8): rate, quota and plan limits calls meet, until a call succeeds.
export * from './limits';

// Settings services (gate criterion 4): models, accounts, compute, returning core's contract types.
export {
  createModelSettingsService,
  type ModelSettingsService,
  type ModelSettingsServiceDeps,
} from './settings/model-settings';
export { createModelCommands, type ModelCommandsDeps } from './settings/model-commands';
export { fallbackReasonKey, moduleOptions, type ModelOptionsContext } from './settings/model-options';
export {
  createAccountsService,
  type AccountsService,
  type AccountsServiceDeps,
} from './settings/accounts-service';
export {
  localServerBaseUrl,
  localServerEndpoint,
  type LocalServerStore,
  type LocalServerUrls,
} from './settings/local-servers';
export { computeReport, type ComputeReportDeps } from './settings/compute-report';

// Prices for cost estimates and what leaves this device, per module (P2-X1, P2-X2).
export * from './privacy/prices';
export * from './privacy/plan-billing';
export {
  MODULE_SENDS,
  moduleNetwork,
  moduleNetworks,
  type ModuleNetwork,
  type ModuleNetworkDeps,
  type RunsOn,
  type SentKind,
} from './privacy/network';
// Quality labels per module under the current settings (P3-B10).
export {
  LOCAL_PARITY_MODULES,
  moduleQualities,
  moduleQuality,
  QUALITY_LABEL_KEYS,
  type ModuleQualityDeps,
} from './privacy/quality-labels';

// Hardware tiers (P1-E4).
export {
  GPU_APIS,
  HARDWARE_TIERS,
  tierRank,
  type AppleChip,
  type GpuApi,
  type GpuInfo,
  type GpuVendor,
  type HardwareInfo,
  type HardwareProbe,
  type HardwareTier,
} from './hardware/types';
export {
  assessHardware,
  TIER_RULES,
  type ComputeSummary,
  type HardwareAssessment,
  type HardwareShortfall,
} from './hardware/tiers';
export {
  availableBackends,
  COMPUTE_BACKENDS,
  isAccelerated,
  selectCompute,
  type ComputeBackend,
  type ComputeChoice,
  type CpuFallbackReason,
  type SelectComputeOptions,
} from './hardware/compute';
export { createMacHardwareProbe, type MacHardwareProbeDeps } from './hardware/mac-probe';
export { defaultCommandRunner, type CommandOutput, type CommandRunner } from './hardware/command-runner';
export { createWindowsHardwareProbe, type WindowsHardwareProbeDeps } from './hardware/windows/windows-probe';
// Linux (LNX1): the probe, the environment switches it honours, and CUDA 13's floors.
export { createLinuxHardwareProbe, type LinuxHardwareProbeDeps } from './hardware/linux/linux-probe';
export type { LinuxFs } from './hardware/linux/linux-fs';
export * from './hardware/accelerator-env';
export * from './hardware/cuda';
export { parseAppleChip, parseGpuCores, parseGpus, parseOsVersion, parseSysctl } from './hardware/parse-mac';
// Job concurrency from the hardware (round IX, design A): class budgets and model lanes.
export {
  describeConcurrency,
  planJobConcurrency,
  SHARED_BUDGETS,
  type PlannedConcurrency,
} from './hardware/concurrency/plan';
export {
  APPLE_TIER_BUDGETS,
  CONCURRENCY_PROFILE_IDS,
  CONCURRENCY_PROFILES,
  cpuBudget,
  NO_NPU_FOLD,
  OFF_APPLE_NPU_BUDGET,
  NVIDIA_VRAM_BUDGETS,
  plannableVramBytes,
  type ConcurrencyProfile,
  type ConcurrencyProfileId,
  type DeviceBudgets,
  type PlanMachine,
} from './hardware/concurrency/profiles';
export { MODEL_LANE_LIMITS, MODEL_LANES, type ModelLane } from './hardware/concurrency/model-lanes';
export { hardwareVideoEngine, VIDEO_ENGINES, type VideoEngine } from './hardware/video-engine';

// Image generation (P3-B7) & Hallmark thumbnail + social publishing pack: API-key paths in route order, the price table and the images tools.
export * from './images';

// EAR1-X1: `audio.cloudCritique`, a consented second opinion on a sound from a hosted audio model.
export * from './listen-critique';

// Record and replay for offline tests (P1-I3).
export {
  cassetteModeFromEnv,
  openCassette,
  type Cassette,
  type CassetteMode,
  type CassetteOptions,
} from './testing/cassette';
export { disableNetwork, NetworkDisabledError, type NetworkGuard } from './testing/network-guard';
export {
  createFakeLocalRuntimeDriver,
  createMemoryComponentInstaller,
  type FakeLocalRuntimeDriver,
  type MemoryComponentInstaller,
  type MemoryComponentInstallerOptions,
} from './testing/fake-local-runtime';
