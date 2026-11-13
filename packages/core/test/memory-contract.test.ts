// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  APP_ROUTES,
  LIBRARY_ENTITIES,
  MAIN_SERVICE_CONTRACTS,
  MEMORY_CLOUD_PROMPTS_SETTING,
  MEMORY_COMMANDS,
  MEMORY_TEXT_MAX,
  memoryCommandPayloads,
  memoryIndexName,
  memoryItemProblems,
  memoryItemSchema,
  memoryListSchema,
  memoryStatusSchema,
  newId,
  templateIndexName,
  UTILITY_CONTRACTS,
} from '../src';

const item = {
  id: newId<'MemoryItem'>(),
  scope: { kind: 'user' as const },
  text: 'Never use whip transitions.',
  source: 'user' as const,
  data: null,
  conversationId: null,
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe('memory contract (LRN1-MEM)', () => {
  it('bounds the text and scopes an item to the user, a project or a template', () => {
    expect(memoryItemSchema.safeParse(item).success).toBe(true);
    expect(memoryItemSchema.safeParse({ ...item, text: '   ' }).success).toBe(false);
    expect(memoryItemSchema.safeParse({ ...item, text: 'x'.repeat(MEMORY_TEXT_MAX + 1) }).success).toBe(
      false,
    );
    expect(memoryItemSchema.safeParse({ ...item, scope: { kind: 'project' } }).success).toBe(false);
    const templateId = newId<'Template'>();
    expect(memoryItemSchema.safeParse({ ...item, scope: { kind: 'template', templateId } }).success).toBe(
      true,
    );
  });

  it('keeps learned data on learned items in their own scope', () => {
    const weights = { intent: 1, motion: 0.5, quality: 0.5, subject: 0.25, energy: 0.25 };
    const data = {
      kind: 'casting-weights' as const,
      configVersion: 'casting.v1',
      defaults: weights,
      weights,
      pairs: 12,
    };
    expect(memoryItemProblems({ ...item, source: 'learned', data })).toEqual([]);
    expect(memoryItemProblems({ ...item, data })).toContain('data is only for learned items');
    const templateScope = { kind: 'template' as const, templateId: newId<'Template'>() };
    expect(memoryItemProblems({ ...item, source: 'learned', scope: templateScope, data })).toHaveLength(1);
    expect(memoryItemProblems({ ...item, conversationId: newId<'Conversation'>() })).toHaveLength(1);
    const outside = { ...data, weights: { ...weights, intent: 2.5, motion: 0.25 } };
    expect(memoryItemProblems({ ...item, source: 'learned', data: outside })).toEqual([
      "casting-weights must be inside their bounds, at the defaults' total",
    ]);
    expect(
      memoryItemSchema.safeParse({ ...item, data: { ...data, weights: { ...weights, intent: 6 } } }).success,
    ).toBe(false);
  });

  it('makes every command app-wide and refuses an empty update', () => {
    const memoryId = newId<'MemoryItem'>();
    const create = memoryCommandPayloads[MEMORY_COMMANDS.create].parse({
      memoryId,
      item: { scope: { kind: 'user' }, text: 'Captions on', source: 'user' },
    });
    expect(create).toMatchObject({ projectId: null, item: { data: null, conversationId: null } });
    const update = memoryCommandPayloads[MEMORY_COMMANDS.update];
    expect(update.safeParse({ memoryId, baseRevision: 1, patch: {} }).success).toBe(false);
    expect(update.safeParse({ memoryId, baseRevision: 1, patch: { text: 'Captions off' } }).success).toBe(
      true,
    );
    expect(MEMORY_CLOUD_PROMPTS_SETTING.defaultValue).toBe(true);
  });

  it('serves memory from the agent and names its index in the active space', () => {
    expect(APP_ROUTES.memory).toBe('agent');
    expect(UTILITY_CONTRACTS.agent.memory).toBeDefined();
    expect(MAIN_SERVICE_CONTRACTS.agent.mainEvents).toBeDefined();
    expect(LIBRARY_ENTITIES).toContain('memory');
    expect(memoryIndexName('eg2_q4_daa72c5')).toBe('eg2_q4_daa72c5_mem');
    expect(memoryIndexName('s')).not.toBe(templateIndexName('s'));
  });

  it('parses a list and a status', () => {
    const view = { ...item, scopeName: null };
    expect(memoryListSchema.parse({ items: [view], total: 1 }).items[0]?.scopeName).toBeNull();
    const status = {
      cloudPrompts: true,
      localOnly: false,
      runsOn: 'cloud',
      providers: ['anthropic'],
      prompts: 'cloud',
      counts: { user: 1, project: 0, template: 0 },
    };
    expect(memoryStatusSchema.safeParse(status).success).toBe(true);
  });
});
