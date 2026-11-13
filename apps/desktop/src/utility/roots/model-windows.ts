// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-CTX: the context window a module's prompts must fit, read when it's needed: the smallest window among the
 * models of the module's chain now (a prompt may go to any of them). The memory block's budget (agent-memory.ts)
 * and the Analyst's page size (templates.resolveCuts, agent-templates.ts) both read it.
 */
import type { Container, ModelModuleId } from '@taalcut/core';
import { ModelProfilesToken, ModelRuntimeToken } from '../../shared/tokens';

/**
 * The smallest window in each module's chain, read on each call (the profiles may change); undefined when no model in
 * it says, or when the composition has no models.
 */
export function moduleContextWindow(container: Container): (module: ModelModuleId) => number | undefined {
  return (module) => {
    if (!container.has(ModelProfilesToken) || !container.has(ModelRuntimeToken)) return undefined;
    const runtime = container.resolve(ModelRuntimeToken);
    const windows = container
      .resolve(ModelProfilesToken)
      .effective(module)
      .chain.flatMap(
        (choice) => runtime.findModel(choice.provider, choice.model, 'chat')?.contextWindow ?? [],
      );
    return windows.length > 0 ? Math.min(...windows) : undefined;
  };
}

/**
 * HFW1: whether every model in a module's chain now takes images, so a tool's pictures (the Designer's renders) go
 * to it as images (agent tool-images.ts); false when the chain is empty or any model in it reads words only.
 */
export function moduleSeesImages(container: Container): (module: ModelModuleId) => boolean {
  return (module) => {
    if (!container.has(ModelProfilesToken) || !container.has(ModelRuntimeToken)) return false;
    const runtime = container.resolve(ModelRuntimeToken);
    const chain = container.resolve(ModelProfilesToken).effective(module).chain;
    return (
      chain.length > 0 &&
      chain.every((choice) => runtime.findModel(choice.provider, choice.model, 'chat')?.input.includes('image'))
    );
  };
}
