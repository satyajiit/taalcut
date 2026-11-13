// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the model picker offers for one module: pi-ai's models plus
 * MODEL_CATALOG (the embedded runtime, on-device ONNX and speech, ElevenLabs),
 * each with why it can't be picked now, if it can't, and where a local one
 * would run (ADR 0002). Out-of-tier and unconfigured models stay in the list,
 * marked, so the picker can explain them. Retired models, and the older
 * generations of the providers Taalcut keeps a current list for
 * (registry/current-models.ts), aren't offered at all (UX3-AGT).
 */
import { CHATGPT_PROVIDER, type ModelOption, type OptionCompute } from '@taalcut/core';
import { CHATGPT_PLAN_THINKING } from '../client/chatgpt-plan-models';
import { ON_DEVICE_THINKING } from '../client/thinking';
import { selectCompute, type ComputeBackend } from '../hardware/compute';
import { tierRank, type HardwareTier } from '../hardware/types';
import { LOCAL_RUNTIME_MODELS } from '../local-runtime/mlx-spec';
import { LOCAL_RUNTIME_PROVIDER } from '../local-runtime/types';
import { choiceKey, MODULES, type ModelKind, type ModuleId } from '../modules';
import { isRetired, type Catalog, type CatalogEntry } from '../registry/catalog';
import { currentModels, isCurated, SUPERSEDED_ON } from '../registry/current-models';
import type { ModelProfile } from '../registry/profile-schema';
import type { ModelInfo, ModelInfoKind, ModelRuntime } from '../runtime/runtime';

export interface ModelOptionsContext {
  readonly runtime: ModelRuntime;
  readonly catalog: Catalog;
  readonly profiles: readonly ModelProfile[];
  readonly tier: HardwareTier;
  /** Unknown until the hardware probe reports; then local options show where they would run. */
  readonly backends?: readonly ComputeBackend[];
  /** TAALCUT_FORCE_CPU (HardwareAssessment.compute.forcedCpu): CPU choices say `disabled`. */
  readonly forcedCpu?: boolean;
  /** 'YYYY-MM-DD'. */
  readonly today: string;
  /** Cloud providers that have a key or a sign-in. Unset: nothing is marked 'not-configured'. */
  readonly configured?: ReadonlySet<string>;
  /** On-device model ids whose weights are downloaded. Unset: nothing is marked 'not-installed'. */
  readonly installed?: ReadonlySet<string>;
}

const PI_KINDS: Partial<Record<ModelKind, ModelInfoKind>> = {
  chat: 'chat',
  classifier: 'classifier',
  image: 'image',
};

/** 'compute.fallback.<reason>', the key the renderer's About screen shows for a CPU fallback. */
export function fallbackReasonKey(reason: string): string {
  const known: Record<string, string> = {
    no_accelerated_backend: 'no_gpu_kernels',
    hardware_lacks_backend: 'gpu_unsupported',
  };
  return `compute.fallback.${known[reason] ?? reason}`;
}

/** Where `entry` runs on a machine with `backends`; `forcedCpu` (TAALCUT_FORCE_CPU) makes a CPU choice `disabled`. */
export function optionCompute(
  entry: CatalogEntry | undefined,
  backends: readonly ComputeBackend[] | undefined,
  forcedCpu = false,
): OptionCompute | undefined {
  if (!entry?.runtime || !entry.compute?.length || !backends) return undefined;
  const where = selectCompute(entry.compute, backends, { forcedCpu });
  return {
    backend: where.backend,
    accelerated: where.accelerated,
    labelKey: where.labelKey,
    ...(where.cpuReason ? { fallbackReasonKey: fallbackReasonKey(where.cpuReason) } : {}),
  };
}

export function moduleOptions(module: ModuleId, context: ModelOptionsContext): ModelOption[] {
  const { runtime, catalog } = context;
  const info = MODULES[module];
  const needsImages = info.needs.includes('image-input');
  const piKinds = new Set(info.kinds.flatMap((k) => (PI_KINDS[k] ? [PI_KINDS[k]] : [])));
  const options = new Map<string, ModelOption>();

  const inProfiles = new Set(
    context.profiles.flatMap((p) => p.modules[module].chain.map((choice) => choiceKey(choice))),
  );
  const add = (provider: string, model: string, found: ModelInfo | undefined) => {
    const key = choiceKey({ provider, model });
    if (options.has(key)) return;
    const entry = catalog.find({ provider, model });
    const local = found?.local ?? entry?.local ?? false;
    const compute = local ? optionCompute(entry, context.backends, context.forcedCpu) : undefined;
    const chat = found ? found.kind === 'chat' : entry?.kind === 'chat';
    // On-device models answer without thinking (client/thinking.ts), whether the runtime is up or not.
    // On the ChatGPT plan, OpenAI's models think at ChatGPT's levels (client/chatgpt-plan-models.ts).
    const levels = found?.thinking ?? ['off'];
    const thinking =
      provider === LOCAL_RUNTIME_PROVIDER
        ? [...ON_DEVICE_THINKING]
        : onChatGPTPlan(provider, context) && levels.some((level) => level !== 'off')
          ? levels.filter((level) => CHATGPT_PLAN_THINKING.includes(level))
          : [...levels];
    options.set(key, {
      provider,
      model,
      name: entry?.name ?? found?.name ?? model,
      local,
      reasoning: found?.reasoning ?? onDeviceReasoning(provider, model),
      ...(chat ? { thinking } : {}),
      ...(inProfiles.has(key) ? { inProfile: true } : {}),
      ...(entry?.noteKey ? { noteKey: entry.noteKey } : {}),
      ...(entry?.retiresOn ? { retiresOn: entry.retiresOn } : {}),
      ...unavailable(provider, model, local, entry, context),
      ...(compute ? { compute } : {}),
    });
  };

  for (const found of runtime.listModels()) {
    if (!piKinds.has(found.kind)) continue;
    if (needsImages && !found.input.includes('image')) continue;
    // Retired, and older generations of the providers Taalcut keeps a current list for, aren't offered.
    if (isRetired(catalog.find({ provider: found.provider, model: found.id }), context.today)) continue;
    if (found.kind === 'chat' && superseded(found.provider, found.id, context.today)) continue;
    add(found.provider, found.id, found);
  }
  for (const entry of catalog.entries()) {
    if (!info.kinds.includes(entry.kind)) continue;
    // A user's own server appears only once they have set it up (Advanced), through runtime.listModels().
    if (entry.servedBy === 'own-server') continue;
    if (entry.servedBy === 'pi-ai') continue;
    if (isRetired(entry, context.today)) continue;
    if (needsImages && !onDeviceVision(entry)) continue;
    add(entry.provider, entry.model, runtime.findModel(entry.provider, entry.model));
  }

  return [...options.values()].sort(
    (a, b) =>
      Number(a.unavailable !== undefined) - Number(b.unavailable !== undefined) ||
      Number(!inProfiles.has(choiceKey(a))) - Number(!inProfiles.has(choiceKey(b))) ||
      Number(!a.local) - Number(!b.local) ||
      a.provider.localeCompare(b.provider) ||
      a.name.localeCompare(b.name),
  );
}

function unavailable(
  provider: string,
  model: string,
  local: boolean,
  entry: CatalogEntry | undefined,
  context: ModelOptionsContext,
): Pick<ModelOption, 'unavailable'> {
  if (isRetired(entry, context.today)) return { unavailable: 'retired' };
  if (entry?.minTier && tierRank(context.tier) < tierRank(entry.minTier)) {
    return { unavailable: 'needs-higher-tier' };
  }
  if (provider === LOCAL_RUNTIME_PROVIDER && context.installed && !context.installed.has(model)) {
    return { unavailable: 'not-installed' };
  }
  const cloudViaPiAi = !local && context.runtime.hasProvider(provider);
  if (cloudViaPiAi && context.configured && !context.configured.has(provider)) {
    return { unavailable: 'not-configured' };
  }
  return {};
}

/** Not among its provider's current models, from the day they replaced the older generations. */
function superseded(provider: string, model: string, today: string): boolean {
  return today >= SUPERSEDED_ON && isCurated(provider) && !currentModels(provider).includes(model);
}

/** OpenAI's models on the ChatGPT plan: main's configured list names it when the openai sign-in is ChatGPT. */
function onChatGPTPlan(provider: string, context: ModelOptionsContext): boolean {
  if (provider === CHATGPT_PROVIDER) return true;
  return provider === 'openai' && context.configured?.has(CHATGPT_PROVIDER) === true;
}

function onDeviceReasoning(provider: string, model: string): boolean {
  if (provider !== LOCAL_RUNTIME_PROVIDER) return false;
  return LOCAL_RUNTIME_MODELS.find((m) => m.id === model)?.reasoning ?? false;
}

function onDeviceVision(entry: CatalogEntry): boolean {
  if (entry.provider !== LOCAL_RUNTIME_PROVIDER) return false;
  return LOCAL_RUNTIME_MODELS.find((m) => m.id === entry.model)?.vision ?? false;
}
