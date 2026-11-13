// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The tool router (P3-B11, packages/agent SPEC section 24) in the agent process: models' classifier over the
 * active profile's `router` chain (TypeSafe Jev pinned to jev-1.13.0, Cloudflare Clef-flash, then the on-device
 * rules router), with the same keys, CloudCall log and Local only switch as every model call; the advisor the
 * loop asks on each act turn; and `agent.setRouter`. The rollout stays core's default, `off`, until a person
 * changes it: nothing here turns it on.
 */
import {
  CloudCallSinkToken,
  ROUTER_SETTING,
  SettingsStoreToken,
  type AnyCommand,
  type Container,
} from '@taalcut/core';
import { createRouteAdvisor, createRouterCommands, type Phase3Deps } from '@taalcut/agent';
import { createClassifier } from '@taalcut/models';
import { CredentialProviderToken, ModelProfilesToken, ModelRuntimeToken } from '../../shared/tokens';
import { LocalOnlyFlagToken } from './agent-flows';

export function routerAgentDeps(container: Container): Pick<Phase3Deps, 'router'> {
  const settings = container.resolve(SettingsStoreToken);
  const classifier = createClassifier({
    runtime: container.resolve(ModelRuntimeToken),
    credentials: container.resolve(CredentialProviderToken),
    callLog: container.resolve(CloudCallSinkToken),
    selector: container.resolve(ModelProfilesToken),
    // Local only leaves the rules router: routing still works, and nothing is sent.
    ...(container.has(LocalOnlyFlagToken)
      ? { localOnly: () => container.resolve(LocalOnlyFlagToken).get() }
      : {}),
  });
  return {
    router: createRouteAdvisor({
      classifier,
      setting: async () => {
        const read = await settings.get(ROUTER_SETTING);
        return read.ok ? read.value : ROUTER_SETTING.defaultValue;
      },
    }),
  };
}

export function routerCommands(container: Container): AnyCommand[] {
  return createRouterCommands({ settings: container.resolve(SettingsStoreToken) }).all;
}
