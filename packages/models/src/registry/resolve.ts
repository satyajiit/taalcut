// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turns a profile plus the user's override into the chain a call will try,
 * for this machine and this day: out-of-tier local models are skipped, a
 * retired model is swapped for its replacement (or dropped), and a local model
 * that would run on the CPU moves behind every GPU and cloud option. Pure functions.
 */
import { selectCompute, type ComputeBackend, type ComputeChoice } from '../hardware/compute';
import { tierRank, type HardwareTier } from '../hardware/types';
import { choiceKey, type ModelChoice, type ModuleId } from '../modules';
import { isRetired, type Catalog } from './catalog';
import type { ModuleOverride, ModuleSetting } from './profile-schema';

export interface SkippedChoice {
  readonly choice: ModelChoice;
  readonly reason: 'needs-higher-tier' | 'retired';
  /** For a retired model: what replaced it in the chain. */
  readonly replacedBy?: ModelChoice;
}

export interface EffectiveModule {
  readonly module: ModuleId;
  /** The chain to try, primary first. */
  readonly chain: readonly ModelChoice[];
  readonly skipped: readonly SkippedChoice[];
  /** Local choices that would run on the CPU here, moved behind every GPU and cloud option (ADR 0002). */
  readonly cpuDemoted: readonly ModelChoice[];
  /** Where each local choice in the chain runs, keyed by choiceKey; for the model picker and About. */
  readonly compute: Readonly<Record<string, ComputeChoice>>;
  readonly overridden: boolean;
}

export interface ResolveContext {
  readonly catalog: Catalog;
  readonly tier: HardwareTier;
  /** ISO date, 'YYYY-MM-DD'. */
  readonly today: string;
  /** This machine's backends (HardwareAssessment.compute.backends). Unknown until the probe reports. */
  readonly backends?: readonly ComputeBackend[];
  /** TAALCUT_FORCE_CPU (HardwareAssessment.compute.forcedCpu): CPU choices say `disabled`. */
  readonly forcedCpu?: boolean;
}

export function applyOverride(setting: ModuleSetting, override: ModuleOverride | undefined): ModelChoice[] {
  if (!override) return [...setting.chain];
  const [profilePrimary, ...profileFallbacks] = setting.chain;
  const base = override.primary ?? profilePrimary;
  const primary = base && override.reasoning ? { ...base, reasoning: override.reasoning } : base;
  const fallbacks = override.fallbacks ?? profileFallbacks;
  return primary ? [primary, ...fallbacks] : [...fallbacks];
}

export function resolveModule(
  module: ModuleId,
  setting: ModuleSetting,
  override: ModuleOverride | undefined,
  context: ResolveContext,
): EffectiveModule {
  const chain: ModelChoice[] = [];
  const cpuDemoted: ModelChoice[] = [];
  const skipped: SkippedChoice[] = [];
  const compute: Record<string, ComputeChoice> = {};
  const seen = new Set<string>();
  const add = (choice: ModelChoice) => {
    const key = choiceKey(choice);
    if (seen.has(key)) return;
    seen.add(key);
    const supported = context.catalog.find(choice)?.compute;
    if (!supported?.length || !context.backends) {
      chain.push(choice);
      return;
    }
    const where = selectCompute(supported, context.backends, { forcedCpu: context.forcedCpu ?? false });
    compute[key] = where;
    // GPU first: a CPU-only local option is tried only after everything else.
    (where.accelerated ? chain : cpuDemoted).push(choice);
  };

  for (const choice of applyOverride(setting, override)) {
    const entry = context.catalog.find(choice);
    if (entry?.minTier && tierRank(context.tier) < tierRank(entry.minTier)) {
      skipped.push({ choice, reason: 'needs-higher-tier' });
      continue;
    }
    if (isRetired(entry, context.today)) {
      const replacement = entry?.replacement
        ? { ...entry.replacement, ...(choice.reasoning ? { reasoning: choice.reasoning } : {}) }
        : undefined;
      skipped.push({ choice, reason: 'retired', ...(replacement ? { replacedBy: replacement } : {}) });
      if (replacement && !isRetired(context.catalog.find(replacement), context.today)) add(replacement);
      continue;
    }
    add(choice);
  }
  return {
    module,
    chain: [...chain, ...cpuDemoted],
    skipped,
    cpuDemoted,
    compute,
    overridden: override !== undefined,
  };
}
