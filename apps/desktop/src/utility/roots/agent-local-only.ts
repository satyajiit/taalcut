// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Local only in the agent's runs (P3-B10, packages/models SPEC P3.6): the Settings switch as last read (a run
 * logs it when it starts) and which modules still run on this Mac, from the same `moduleQuality` the privacy
 * overview's labels use, so a module labelled "Needs internet" is the one whose tools are refused.
 */
import { MODEL_MODULE_IDS, type Container, type ModelModuleId } from '@taalcut/core';
import type { LocalOnlyDeps } from '@taalcut/agent';
import { moduleQuality } from '@taalcut/models';
import { ModelProfilesToken, ModelRuntimeToken } from '../../shared/tokens';
import { LocalOnlyFlagToken } from './agent-flows';

const isModule = (module: string): module is ModelModuleId =>
  (MODEL_MODULE_IDS as readonly string[]).includes(module);

export function localOnlyAgentDeps(container: Container): { readonly localOnly?: LocalOnlyDeps } {
  if (!container.has(LocalOnlyFlagToken)) return {};
  const flag = container.resolve(LocalOnlyFlagToken);
  const profiles = container.resolve(ModelProfilesToken);
  const runtime = container.resolve(ModelRuntimeToken);
  return {
    localOnly: {
      now: () => flag.get(),
      onDevice: (module) =>
        isModule(module) &&
        moduleQuality({ selector: profiles, runtime, localOnly: true, tier: profiles.tier() }, module)
          .quality !== 'unavailable',
    },
  };
}
