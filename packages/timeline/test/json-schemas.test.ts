// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every timeline tool's and skill's input and output converts to JSON Schema
 * the way the tool registry exports them (unrepresentable: 'throw'), for each
 * target the providers use.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { visualLayoutTool } from '../src/tools/visual-layout-tool';
import { timelineSkillModule } from '../src/skills/skills';
import { getToolOutputSchema } from '../src/tools/schemas';
import { agentWorld } from './fixtures/agent';

const TARGETS = ['draft-2020-12', 'draft-07', 'openapi-3.0'] as const;

function problem(name: string, schema: z.ZodType, io: 'input' | 'output'): string[] {
  try {
    for (const target of TARGETS) z.toJSONSchema(schema, { target, io, unrepresentable: 'throw' });
    return [];
  } catch (cause) {
    return [`${name} ${io}: ${cause instanceof Error ? cause.message : String(cause)}`];
  }
}

describe('timeline JSON Schemas', () => {
  it('every tool input and output converts', () => {
    const { tools } = agentWorld();
    const problems = tools.tools.flatMap((tool) => [
      ...problem(tool.name, tool.input, 'input'),
      ...problem(tool.name, tool.output, 'output'),
    ]);
    expect(problems).toEqual([]);
  });

  it('native layout tool exports source-time keys to every provider schema', () => {
    const tool = visualLayoutTool();
    expect(problem(tool.name, tool.input, 'input')).toEqual([]);
    expect(problem(tool.name, tool.output, 'output')).toEqual([]);
  });

  it('every skill input and output converts', () => {
    const { service, templates } = agentWorld();
    const module = timelineSkillModule({ service, templates });
    const problems = module.skills.flatMap((skill) => [
      ...problem(skill.id, skill.input, 'input'),
      ...problem(skill.id, skill.output, 'output'),
    ]);
    expect(problems).toEqual([]);
  });

  it('fences overlay text and the timeline name for the model (agent SPEC 7, 12)', () => {
    type Node = { untrusted?: string; properties?: Record<string, Node>; items?: Node };
    const json = z.toJSONSchema(getToolOutputSchema, { io: 'output', unrepresentable: 'throw' }) as Node;
    // The agent lifts a string into <untrusted> only when the string's own node carries the mark.
    expect(json.properties?.texts?.items?.properties?.text?.untrusted).toBe('on-screen-text');
    expect(json.properties?.texts?.untrusted).toBeUndefined();
    expect(json.properties?.name?.untrusted).toBe('user-text');
  });
});
