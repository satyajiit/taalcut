// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Prices for cost estimates (P2-X1, G8): what a module's work costs per
 * million tokens on the model that would run it now, and what the module's
 * other selectable models would cost for the same work, so the agent can
 * offer a cheaper one when a project's cap is hit. Prices come from pi-ai's
 * catalogue through the runtime; anything that runs on this Mac costs US$0
 * whatever a catalogue says.
 */
import { CHATGPT_PROVIDER } from '@taalcut/core';
import { planModelFor } from '../client/chatgpt-plan-models';
import type { ComputeBackend } from '../hardware/compute';
import type { HardwareTier } from '../hardware/types';
import type { ModelChoice, ModuleId } from '../modules';
import { createCatalog, type Catalog } from '../registry/catalog';
import type { ModelProfile } from '../registry/profile-schema';
import type { EffectiveModule } from '../registry/resolve';
import type { ModelRuntime } from '../runtime/runtime';
import { moduleOptions } from '../settings/model-options';

/** US$ per million tokens. */
export interface TokenPrices {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
}

/** One model priced for a module's work. */
export interface ModulePrice {
  readonly module: ModuleId;
  /** CHATGPT_PROVIDER for an OpenAI model on the person's ChatGPT plan (planBilled), as Accounts names it. */
  readonly provider: string;
  readonly model: string;
  /** Runs on this Mac: free, and nothing leaves the device. */
  readonly local: boolean;
  /** FIX-RUN: billed to a plan the person signed in with: free per token, so no token budget counts it. */
  readonly planBilled?: boolean;
  readonly usdPerMTok: TokenPrices;
}

export interface PriceLookup {
  /** The model the module's chain would run first; undefined when the module has nothing to run. */
  price(module: ModuleId): ModulePrice | undefined;
  /** The module's selectable models, priced: on this Mac first, then cheapest first. */
  options(module: ModuleId): ModulePrice[];
}

/** What the lookup reads from the profiles service (ModelProfiles has all of it). */
export interface PriceSelector {
  effective(module: ModuleId): Pick<EffectiveModule, 'chain'>;
  profiles(): readonly ModelProfile[];
  tier(): HardwareTier;
}

export interface PriceLookupDeps {
  readonly selector: PriceSelector;
  readonly runtime: Pick<ModelRuntime, 'findModel' | 'isLocalProvider' | 'listModels' | 'hasProvider'>;
  readonly catalog?: Catalog;
  /** 'YYYY-MM-DD'. Default: today in UTC. */
  readonly today?: () => string;
  /** The machine's compute backends, once probed (local options that can't run are still listed). */
  readonly backends?: () => readonly ComputeBackend[] | undefined;
  /** Cloud providers with a key or sign-in. Unset: every cloud option counts as available. */
  readonly configured?: () => ReadonlySet<string> | undefined;
  /** On-device model ids whose weights are downloaded. Unset: every local option counts as installed. */
  readonly installed?: () => ReadonlySet<string> | undefined;
  /** Providers billed to a plan the person signed in with (PlanBilling): US$0, nothing counts against a cap. */
  readonly planBilled?: (provider: string) => boolean;
}

const FREE: TokenPrices = { input: 0, output: 0, cacheRead: 0 };
const utcToday = (): string => new Date().toISOString().slice(0, 10);

/** What some work costs at a price, in US$: tokens × price per million. */
export function estimateUsd(
  price: Pick<ModulePrice, 'usdPerMTok'>,
  usage: { readonly inputTokens: number; readonly outputTokens: number; readonly cachedInputTokens?: number },
): number {
  const { input, output, cacheRead } = price.usdPerMTok;
  return (
    (usage.inputTokens * input + usage.outputTokens * output + (usage.cachedInputTokens ?? 0) * cacheRead) /
    1_000_000
  );
}

export function createPriceLookup(deps: PriceLookupDeps): PriceLookup {
  const catalog = deps.catalog ?? createCatalog();
  const today = deps.today ?? utcToday;

  const isLocal = (choice: Pick<ModelChoice, 'provider' | 'model'>): boolean =>
    deps.runtime.isLocalProvider(choice.provider) || catalog.find(choice)?.local === true;

  /** A choice priced, or undefined for a cloud model the runtime doesn't know (no price to give). */
  const priced = (module: ModuleId, choice: Pick<ModelChoice, 'provider' | 'model'>) => {
    const base = { module, provider: choice.provider, model: choice.model };
    if (isLocal(choice)) return { ...base, local: true, usdPerMTok: FREE };
    // On a plan: no per-token price to give, and an OpenAI model is the ChatGPT plan's (servingProvider's reverse),
    // named as the plan model that runs it (planModelFor).
    if (deps.planBilled?.(choice.provider)) {
      const chatgpt = choice.provider === 'openai' || choice.provider === CHATGPT_PROVIDER;
      return chatgpt
        ? {
            ...base,
            provider: CHATGPT_PROVIDER,
            model: planModelFor(choice.model),
            local: false,
            planBilled: true,
            usdPerMTok: FREE,
          }
        : { ...base, local: false, planBilled: true, usdPerMTok: FREE };
    }
    const info = deps.runtime.findModel(choice.provider, choice.model);
    if (!info) return undefined;
    if (info.local) return { ...base, local: true, usdPerMTok: FREE };
    const { input, output, cacheRead } = info.price;
    return { ...base, local: false, usdPerMTok: { input, output, cacheRead } };
  };

  return {
    price(module) {
      for (const choice of deps.selector.effective(module).chain) {
        const found = priced(module, choice);
        if (found) return found;
      }
      return undefined;
    },

    options(module) {
      const backends = deps.backends?.();
      const configured = deps.configured?.();
      const installed = deps.installed?.();
      const listed = moduleOptions(module, {
        runtime: deps.runtime as ModelRuntime,
        catalog,
        profiles: deps.selector.profiles(),
        tier: deps.selector.tier(),
        today: today(),
        ...(backends ? { backends } : {}),
        ...(configured ? { configured } : {}),
        ...(installed ? { installed } : {}),
      });
      const seen = new Set<string>();
      const prices = listed
        // Something the user can't switch to now (retired, out of tier, not set up) isn't an option.
        .filter((option) => option.unavailable === undefined)
        .flatMap((option) => {
          const found = priced(module, option);
          // OpenAI's model and the ChatGPT plan's same model are one option on the plan.
          const key = found ? `${found.provider}/${found.model}` : '';
          if (!found || seen.has(key)) return [];
          seen.add(key);
          return [found];
        });
      const perToken = (p: ModulePrice) => p.usdPerMTok.input + p.usdPerMTok.output;
      return prices.sort(
        (a, b) =>
          Number(!a.local) - Number(!b.local) ||
          perToken(a) - perToken(b) ||
          a.provider.localeCompare(b.provider) ||
          a.model.localeCompare(b.model),
      );
    },
  };
}
