// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Model calls for the jobs process's background work (core's BackgroundModels:
 * vision's shot descriptions), which main forwards here (P2-L8). Served over
 * this process's ModelClient, profiles, runtime and standing upload consents,
 * resolved per call so the process starts before the model stack is needed.
 */
import {
  backgroundModelsRouter,
  SettingsStoreToken,
  type BackgroundModels,
  type Container,
} from '@taalcut/core';
import { createBackgroundModels } from '@taalcut/models';
import { ModelClientToken, ModelProfilesToken, ModelRuntimeToken } from '../../shared/tokens';

/**
 * This process's BackgroundModels, made at the first call: the model stack starts after the process. The jobs
 * process's calls (below) and the agent's own background work (LRN1-STY's style summaries) share the shape.
 */
export function lazyBackgroundModels(container: Container): BackgroundModels {
  let served: BackgroundModels | undefined;
  return {
    complete: (...args) =>
      (served ??= createBackgroundModels({
        client: container.resolve(ModelClientToken),
        selector: container.resolve(ModelProfilesToken),
        isLocalProvider: (provider) => container.resolve(ModelRuntimeToken).isLocalProvider(provider),
        settings: container.resolve(SettingsStoreToken),
      })).complete(...args),
  };
}

export function backgroundModelsRouters(container: Container) {
  return { backgroundModels: backgroundModelsRouter(lazyBackgroundModels(container)) };
}
