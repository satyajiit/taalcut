// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a run's casting config is resolved (SPEC, "Learned casting preferences"): the versioned config, with its
 * five score weights replaced by the learned item's when there is one for this config version. Casting, the
 * alternates, hook variants and template fit all ask here per call, so an edit or a reset in Settings applies to
 * the next one. The answer says which weights it used, so a cast can be replayed exactly.
 */
import { ok, type AsyncResult, type MemoryId, type MemoryStore, type CastingWeights } from '@taalcut/core';
import { CASTING_CONFIG, type CastingConfig } from '../config';
import { weightsOfData } from './fold';

export type CastingWeightsUsed =
  | { readonly source: 'default'; readonly values: CastingWeights }
  | {
      readonly source: 'learned';
      readonly values: CastingWeights;
      readonly memoryId: MemoryId;
      /** The item's `updatedAt` (epoch ms) when it was read. */
      readonly updatedAt: number;
    };

export interface ResolvedCastingConfig {
  readonly config: CastingConfig;
  readonly weights: CastingWeightsUsed;
  /** What a cast records as its config version: `casting.v1`, or `casting.v1+learned@<updatedAt>`. */
  readonly label: string;
}

export interface CastingConfigSource {
  resolve(signal?: AbortSignal): AsyncResult<ResolvedCastingConfig>;
}

const defaults = (config: CastingConfig): ResolvedCastingConfig => ({
  config,
  weights: { source: 'default', values: config.weights },
  label: config.version,
});

/** Always this config as it is: tests, evals, and a process without memory. */
export function staticCastingConfig(config: CastingConfig = CASTING_CONFIG): CastingConfigSource {
  const resolved = defaults(config);
  return { resolve: async () => ok(resolved) };
}

export interface LearnedCastingConfigDeps {
  readonly store: Pick<MemoryStore, 'list'>;
  readonly base?: CastingConfig;
}

/** The learned item, newest first, in the user scope. */
export const LEARNED_WEIGHTS_FILTER = {
  kinds: ['user'],
  sources: ['learned'],
  dataKind: 'casting-weights',
  limit: 1,
} as const;

/** The config with the learned weights when the user scope holds an item for this config version. */
export function learnedCastingConfig(deps: LearnedCastingConfigDeps): CastingConfigSource {
  const base = deps.base ?? CASTING_CONFIG;
  return {
    async resolve() {
      const listed = await deps.store.list(LEARNED_WEIGHTS_FILTER);
      if (!listed.ok) return listed;
      const item = listed.value[0];
      const data = item?.data;
      if (!item || data?.kind !== 'casting-weights' || data.configVersion !== base.version)
        return ok(defaults(base));
      const values = weightsOfData(data, base) ?? base.weights;
      return ok({
        config: { ...base, weights: values },
        weights: { source: 'learned', values, memoryId: item.id, updatedAt: item.updatedAt },
        label: `${base.version}+learned@${item.updatedAt}`,
      });
    },
  };
}
