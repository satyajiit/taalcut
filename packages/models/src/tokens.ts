// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The models package's DI tokens (core SPEC section 4: '<package>.<camelCase>'
 * keys, declared next to what they stand for). Composition roots register
 * these; core's ports that models writes through (CloudCallSinkToken,
 * ModelProfileStoreToken) stay in core.
 */
import { createToken, type AsyncResult } from '@taalcut/core';
import type { ModelClient } from './client/types';
import type { CachingCredentialProvider } from './credentials/credential-provider';
import type { HardwareAssessment } from './hardware/tiers';
import type { HardwareInfo } from './hardware/types';
import type { ImageProvider } from './images/image-types';
import type { LocalRuntimeLease } from './local-runtime/manager';
import type { UsageLimitsTracker } from './limits/usage-limits';
import type { LocalRuntime } from './local-runtime/types';
import type { PlanBilling } from './privacy/plan-billing';
import type { ModelProfiles } from './registry/profiles';
import type { ModelRuntime } from './runtime/runtime';
import type { ModelSettingsService } from './settings/model-settings';

/** This machine as models sees it: the probe's facts and the tier they earn. */
export interface ProbedHardware {
  readonly info: HardwareInfo;
  readonly assessment: HardwareAssessment;
}

/** The embedded local runtime as a process holds it: started once the tier is known, leased per call. */
export interface LocalRuntimeSlot {
  /** ModelClientDeps.localLease: holds the runtime for one on-device call, serving `model` when it is installed. */
  localLease(
    provider: string,
    signal?: AbortSignal,
    model?: string,
  ): AsyncResult<LocalRuntimeLease | undefined>;
  /** The running runtime's state and loaded models (Settings → About), once started. */
  runtime(): Pick<LocalRuntime, 'status' | 'loadedModels'> | undefined;
  /** Once the hardware is known: the tier decides which installed models may load. */
  start(hardware: Pick<HardwareAssessment, 'tier' | 'compute'>): void;
  /** Around an export: free the GPU, then take it back. */
  stopForExport(): AsyncResult<void>;
  resumeAfterExport(): AsyncResult<void>;
  dispose(): Promise<void>;
}

export const ModelClientToken = createToken<ModelClient>('models.modelClient');
export const ModelRuntimeToken = createToken<ModelRuntime>('models.runtime');
export const ModelProfilesToken = createToken<ModelProfiles>('models.profiles');
/** Settings → Models over the profiles, and the commands that change them. */
export const ModelSettingsToken = createToken<ModelSettingsService>('models.settings');
/** Credentials for model calls, cached; told to forget a provider after its credential changes. */
export const CredentialProviderToken = createToken<CachingCredentialProvider>('models.credentialProvider');
/** This machine's hardware and tier, probed on first use and kept. */
export const HardwareProbeToken = createToken<() => Promise<ProbedHardware>>('models.hardwareProbe');
/** The embedded local runtime (the llama.cpp sidecar) in the process that makes model calls. */
export const LocalRuntimeToken = createToken<LocalRuntimeSlot>('models.localRuntime');
/** G8: the limits this process's model calls met (core's UsageLimits, plus what the client and runs report). */
export const UsageLimitsTrackerToken = createToken<UsageLimitsTracker>('models.usageLimits');
/** P3-B7: the image providers in route order (createImageProviders), for the images tool and the gap card. */
export const ImageProvidersToken = createToken<readonly ImageProvider[]>('models.imageProviders');
/** UX3-AGT: which providers bill a signed-in plan, not per token (the price lookup's planBilled). */
export const PlanBillingToken = createToken<PlanBilling>('models.planBilling');
