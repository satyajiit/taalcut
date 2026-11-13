// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, ok, PRODUCT_COMMANDS, unwrap, type CommandToolContext } from '@taalcut/core';
import { createToolRegistry } from '@taalcut/tools';
import { describe, expect, it, vi } from 'vitest';
import { productToolModule } from '../../src/products';

function module() {
  return productToolModule({
    list: async () => ok({ items: [], nextCursor: null }),
    knowledge: async () => ok({ items: [] }),
  });
}

describe('product tool registration', () => {
  it('registers every production tool with JSON model schemas and complete cloud metadata', () => {
    const registry = unwrap(createToolRegistry([module()]));
    expect(
      registry
        .catalogue()
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['products.choose', 'products.knowledge', 'products.list', 'products.research']);
    for (const name of ['products.research', 'products.choose']) {
      expect(registry.describe(name)).toMatchObject({
        costClass: 'cloud',
        sideEffect: 'write',
        estimatesCost: true,
        permission: { network: 'internet', cloudModules: ['agent'] },
      });
    }
    expect(registry.describe('products.choose')?.alwaysAsk).toBe(true);
    const list = module().tools.find((tool) => tool.name === 'products.list')!;
    expect(list.input.parse({})).toEqual({ limit: 50, archived: false });
    expect(list.input.safeParse({ after: 'invalid-id' }).success).toBe(false);
  });

  it.each([
    ['products.research', PRODUCT_COMMANDS.research],
    ['products.choose', PRODUCT_COMMANDS.choose],
  ])('preserves %s command payloads and idempotency', async (name, command) => {
    const tool = module().tools.find((candidate) => candidate.name === name)!;
    const input = {
      productId: newId<'Product'>(),
      ...(name === 'products.choose' ? { ideaId: newId<'ProductIdea'>() } : {}),
    };
    const dispatch = vi.fn(async () => ok(undefined));
    expect(tool.command).toBe(command);
    expect(await tool.run(tool.input.parse(input), { dispatch } as unknown as CommandToolContext)).toEqual(
      ok({ accepted: true }),
    );
    expect(dispatch).toHaveBeenCalledWith(input);
    expect(tool.idempotencyKey?.(input)).toBe(tool.idempotencyKey?.(structuredClone(input)));
  });
});
