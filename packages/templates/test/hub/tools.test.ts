// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Hub tools: search, fork and open Share. Publish, rate and report stay with the person. */
import { describe, expect, it } from 'vitest';
import { newId, toolModuleProblems, type HubService } from '@taalcut/core';
import { z } from 'zod';
import { hubToolModule } from '../../src/hub/hub-tools';

type Node = { untrusted?: string; properties?: Record<string, Node>; items?: Node };

function module() {
  return hubToolModule({
    service: {} as HubService,
    ids: { template: () => newId() },
    openShare: () => undefined,
  });
}

describe('hub tools', () => {
  it('registers a module with no metadata problems', () => {
    const tools = module();
    expect(toolModuleProblems(tools)).toEqual([]);
    expect(tools.id).toBe('hub');
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(['hub.fork', 'hub.openShare', 'hub.search']);
    for (const tool of tools.tools) {
      expect(tool.input).toBeInstanceOf(z.ZodObject);
      expect(tool.output).toBeInstanceOf(z.ZodObject);
    }
    const fork = tools.tools.find((tool) => tool.name === 'hub.fork');
    const search = tools.tools.find((tool) => tool.name === 'hub.search');
    const openShare = tools.tools.find((tool) => tool.name === 'hub.openShare');
    expect(fork?.command).toBe('hub.fork');
    expect(fork?.sideEffect).toBe('write');
    expect(search?.command).toBeUndefined();
    expect(search?.cache).toEqual({ ttlMs: 10 * 60 * 1000 });
    expect(search?.permission).toEqual({ network: 'internet' });
    expect(openShare?.command).toBeUndefined();
    expect(openShare?.retry).toEqual({ maxAttempts: 1, initialDelayMs: 0 });
    expect(openShare?.permission).toEqual({ network: 'none' });
  });

  it('marks hub names, descriptions and handles as untrusted user text', () => {
    const search = module().tools.find((tool) => tool.name === 'hub.search');
    const json = z.toJSONSchema(search!.output, { io: 'output', unrepresentable: 'throw' }) as Node;
    const item = json.properties?.entries?.items;
    expect(item?.properties?.name?.untrusted).toBe('user-text');
    expect(item?.properties?.description?.untrusted).toBe('user-text');
    expect(item?.properties?.handle?.untrusted).toBe('user-text');
    for (const tool of module().tools) {
      expect(() => z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'throw' })).not.toThrow();
      expect(() => z.toJSONSchema(tool.output, { io: 'output', unrepresentable: 'throw' })).not.toThrow();
    }
  });
});
