// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM: Settings → Memory's service. The list filters by scope kind and counts everything there is (or what a
 * search found); the status line says where the prompts go from the same module plans Privacy shows, and whether
 * memory goes with them, the same decision recall makes.
 */
import {
  createMemorySettingsStore,
  LOCAL_ONLY_SETTING,
  MEMORY_CLOUD_PROMPTS_SETTING,
  newId,
  ok,
  unwrap,
  type MemoryFilter,
  type MemoryItemView,
  type ModelModuleId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryService, promptPlan, promptUse, type PrivacyModulePlan } from '../../src';
import { memoryView } from './memory-support';

const plan = (module: ModelModuleId, runsOn: PrivacyModulePlan['runsOn'], providers: string[] = []) => ({
  module,
  runsOn,
  providers,
  sends: [],
});

describe('promptPlan and promptUse', () => {
  it('sums up where the prompt modules run, ignoring the others and the ones off', () => {
    const plans = [
      plan('agent', 'cloud', ['anthropic']),
      plan('vision', 'cloud', ['openai']),
      plan('music', 'off'),
      plan('speech', 'this-mac'),
    ];
    expect(promptPlan(plans, ['agent'])).toEqual({ runsOn: 'cloud', providers: ['anthropic'] });
    expect(promptPlan(plans, ['agent', 'speech'])).toEqual({ runsOn: 'both', providers: ['anthropic'] });
    expect(promptPlan(plans, ['speech'])).toEqual({ runsOn: 'this-mac', providers: [] });
    expect(promptPlan(plans, ['music'])).toEqual({ runsOn: 'off', providers: [] });
  });

  it('keeps memory on the Mac, sends it to the cloud, or withholds it, as recall does', () => {
    expect(promptUse(true, 'cloud', false)).toBe('on-device');
    expect(promptUse(false, 'this-mac', false)).toBe('on-device');
    expect(promptUse(false, 'both', true)).toBe('cloud');
    expect(promptUse(false, 'cloud', false)).toBe('withheld');
  });
});

describe('the memory service', () => {
  function setup(items: MemoryItemView[]) {
    const settings = createMemorySettingsStore();
    const asked: MemoryFilter[] = [];
    const matches = (item: MemoryItemView, filter: MemoryFilter) =>
      (!filter.kinds || filter.kinds.includes(item.scope.kind)) &&
      (!filter.query || item.text.toLowerCase().includes(filter.query.toLowerCase()));
    const service = createMemoryService({
      store: {
        list: async (filter = {}) => {
          asked.push(filter);
          return ok(items.filter((item) => matches(item, filter)));
        },
        count: async (filter = {}) => ok(items.filter((item) => matches(item, filter)).length),
      },
      settings,
      modules: (localOnly) => [
        plan('agent', localOnly ? 'this-mac' : 'cloud', localOnly ? [] : ['anthropic']),
      ],
      promptModules: () => ['agent'],
    });
    return { service, settings, asked };
  }

  const projectId = newId<'Project'>();
  const items = [
    memoryView('Never use whip transitions.'),
    memoryView('Open on the drone.', { scope: { kind: 'project', projectId }, scopeName: 'Goa' }),
    memoryView('Captions in teal.'),
  ];

  it('lists by scope kind with the total, and a search with what it found', async () => {
    const { service, asked } = setup(items);
    expect(unwrap(await service.list({}))).toMatchObject({ total: 3 });
    const users = unwrap(await service.list({ scope: 'user' }));
    expect(users.items.map((item) => item.text)).toEqual([
      'Never use whip transitions.',
      'Captions in teal.',
    ]);
    expect(users.total).toBe(2);
    expect(unwrap(await service.list({ query: 'whip' }))).toMatchObject({ total: 1 });
    expect(asked.at(-1)).toEqual({ query: 'whip' });
  });

  it('says plainly where memory goes, and follows the switch and Local only', async () => {
    const { service, settings } = setup(items);
    expect(unwrap(await service.status())).toEqual({
      cloudPrompts: true,
      localOnly: false,
      runsOn: 'cloud',
      providers: ['anthropic'],
      prompts: 'cloud',
      counts: { user: 2, project: 1, template: 0 },
    });
    unwrap(await settings.set(MEMORY_CLOUD_PROMPTS_SETTING, false));
    expect(unwrap(await service.status())).toMatchObject({ cloudPrompts: false, prompts: 'withheld' });
    unwrap(await settings.set(LOCAL_ONLY_SETTING, true));
    expect(unwrap(await service.status())).toMatchObject({
      localOnly: true,
      runsOn: 'this-mac',
      prompts: 'on-device',
    });
  });
});
