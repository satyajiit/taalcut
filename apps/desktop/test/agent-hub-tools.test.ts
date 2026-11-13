// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's hub tools (agent-hub-tools.ts): offered once the library has registered the hub stores, over the one
 * hub client the `hub` router serves; not offered before.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ClockToken,
  createContainer,
  createEventBus,
  createManualClock,
  createMemorySettingsStore,
  EventBusToken,
  HubIndexCacheToken,
  HubSubmissionStoreToken,
  newId,
  ok,
  SettingsStoreToken,
  TemplateStoreToken,
  type HubIndexCache,
  type HubSubmissionStore,
} from '@taalcut/core';
import { createMemoryTemplateStore } from '@taalcut/templates/test-support';
import { hubClientOf } from '../src/utility/roots/agent-hub-client';
import { hubToolModules } from '../src/utility/roots/agent-hub-tools';
import { launchToolModules } from '../src/utility/roots/agent-launch';
import { registerSoul } from '../src/utility/roots/agent-soul';

const SOUL = readFileSync(join(import.meta.dirname, '..', '..', '..', 'SOUL.md'), 'utf8');

const emptyCache: HubIndexCache = {
  readIndex: async () => ok(null),
  writeIndex: async () => ok(undefined),
  readRatings: async () => ok(null),
  writeRatings: async () => ok(undefined),
};

const noSubmissions: HubSubmissionStore = {
  record: async () => ok(undefined),
  setState: async () => ok(undefined),
  list: async () => ok([]),
  latestFor: async () => ok(null),
};

function agentContainer(withHubStores: boolean) {
  const clock = createManualClock(0);
  const container = createContainer()
    .value(ClockToken, clock)
    .value(EventBusToken, createEventBus({ clock }))
    .value(SettingsStoreToken, createMemorySettingsStore())
    .value(TemplateStoreToken, createMemoryTemplateStore(clock));
  if (withHubStores) {
    container.value(HubIndexCacheToken, emptyCache).value(HubSubmissionStoreToken, noSubmissions);
  }
  return container;
}

const toolNames = (modules: ReturnType<typeof hubToolModules>) =>
  modules.flatMap((module) => module.tools.map((tool) => tool.name));

describe('hub tools in the agent process', () => {
  it('offers hub.search, hub.fork and hub.openShare once the hub stores are registered', () => {
    const container = agentContainer(true);
    expect(toolNames(hubToolModules(container))).toEqual(['hub.search', 'hub.fork', 'hub.openShare']);
  });

  it('offers none of them without the hub stores', () => {
    const container = agentContainer(false);
    expect(hubToolModules(container)).toEqual([]);
    expect(hubClientOf(container)).toBeNull();
  });

  it('builds the hub client once, so the router, commands and tools share it', () => {
    const container = agentContainer(true);
    const first = hubClientOf(container);
    expect(first).not.toBeNull();
    expect(hubClientOf(container)).toBe(first);
  });

  it("asks the window to open the Share card through the client's ui.action", () => {
    const container = agentContainer(true);
    const actions: unknown[] = [];
    container.resolve(EventBusToken).on('ui.action', (event) => actions.push(event.payload));
    const templateId = newId<'Template'>();
    hubClientOf(container)?.openShare(templateId, 3);
    expect(actions).toEqual([{ action: 'hub.openShare', args: { templateId, version: '3' } }]);
  });

  it("comes last in Phase 3's tools, after the soul and image modules", () => {
    const container = agentContainer(true);
    registerSoul(container, SOUL);
    const ids = launchToolModules(container).map((module) => module.id);
    expect(ids.at(-1)).toBe('hub');
  });
});
