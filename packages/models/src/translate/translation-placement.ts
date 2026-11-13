// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a translation would run now (core's TRANSLATION_PLACEMENTS): on this Mac, in the cloud, or nowhere. The
 * `agent` chain's first model decides; under Local only only models on this Mac count.
 */
import type { TRANSLATION_PLACEMENTS } from '@taalcut/core';
import type { ModelSelector } from '../client/model-client';
import type { ModelRuntime } from '../runtime/runtime';

export type TranslationPlacement = (typeof TRANSLATION_PLACEMENTS)[number];

export interface PlacementDeps {
  readonly selector: ModelSelector;
  readonly runtime: Pick<ModelRuntime, 'isLocalProvider'>;
  readonly localOnly: () => boolean;
}

export function translationPlacement(deps: PlacementDeps): TranslationPlacement {
  const chain = deps.selector.resolve('agent');
  const choices = chain.ok ? chain.value.choices : [];
  const isLocal = (provider: string) => deps.runtime.isLocalProvider(provider);
  if (choices.length === 0) return 'off';
  if (deps.localOnly()) return choices.some((choice) => isLocal(choice.provider)) ? 'local' : 'off';
  return isLocal(choices[0]?.provider ?? '') ? 'local' : 'cloud';
}
