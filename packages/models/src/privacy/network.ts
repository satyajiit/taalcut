// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What leaves this device, per module (P2-X2, G9): where a module runs now
 * (this Mac, the cloud, both, or off), which cloud providers its chain may
 * send to, and what kind of thing it sends. Settings → Privacy shows it next
 * to the module's CloudCall numbers. With Local only on, only the models on
 * this Mac count: the ModelClient refuses the rest.
 */
import type { SENT_KINDS } from '@taalcut/core';
import { MODULE_IDS, type ModelChoice, type ModuleId } from '../modules';
import { createCatalog, type Catalog } from '../registry/catalog';
import type { EffectiveModule } from '../registry/resolve';
import type { ModelRuntime } from '../runtime/runtime';

export type SentKind = (typeof SENT_KINDS)[number];
export type RunsOn = 'this-mac' | 'cloud' | 'both' | 'off';

/**
 * What each module sends when it runs in the cloud. The agent sends the chat
 * (messages, tool results, its prompts); vision sends video frames with a
 * prompt, and the sound itself for audio.cloudCritique (EAR1-X1); speech sends
 * audio; embeddings send the text they embed (search
 * queries, shot descriptions, transcripts), which is on this Mac in v1;
 * voice, music and image generation send their prompts.
 */
export const MODULE_SENDS: Readonly<Record<ModuleId, readonly SentKind[]>> = {
  agent: ['messages', 'tool-results', 'prompts'],
  router: ['messages'],
  vision: ['frames', 'audio', 'prompts'],
  embeddings: ['prompts', 'transcripts'],
  speech: ['audio'],
  voice: ['prompts'],
  music: ['prompts'],
  images: ['prompts'],
};

export interface ModuleNetwork {
  readonly module: ModuleId;
  readonly runsOn: RunsOn;
  /** Cloud providers in chain order, each once; empty when it runs only here (or is off). */
  readonly providers: readonly string[];
  readonly sends: readonly SentKind[];
}

export interface ModuleNetworkDeps {
  readonly selector: { effective(module: ModuleId): Pick<EffectiveModule, 'chain'> };
  readonly runtime: Pick<ModelRuntime, 'isLocalProvider'>;
  readonly catalog?: Catalog;
  /** Local only is on: only models on this Mac count. */
  readonly localOnly?: boolean;
}

export function moduleNetwork(deps: ModuleNetworkDeps, module: ModuleId): ModuleNetwork {
  const catalog = deps.catalog ?? createCatalog();
  const isLocal = (choice: ModelChoice) =>
    deps.runtime.isLocalProvider(choice.provider) || catalog.find(choice)?.local === true;
  const chain = deps.selector.effective(module).chain;
  const local = chain.filter(isLocal);
  const cloud = deps.localOnly ? [] : chain.filter((choice) => !isLocal(choice));
  const runsOn: RunsOn =
    local.length > 0 ? (cloud.length > 0 ? 'both' : 'this-mac') : cloud.length > 0 ? 'cloud' : 'off';
  return {
    module,
    runsOn,
    providers: [...new Set(cloud.map((choice) => choice.provider))],
    sends: MODULE_SENDS[module],
  };
}

/** Every module, in MODULE_IDS order. */
export function moduleNetworks(deps: ModuleNetworkDeps): ModuleNetwork[] {
  const catalog = deps.catalog ?? createCatalog();
  return MODULE_IDS.map((module) => moduleNetwork({ ...deps, catalog }, module));
}
