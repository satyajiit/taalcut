// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The skill registry (SPEC section 11). Domain packages declare skills with
 * core's defineSkill and export a SkillModule; the composition root resolves
 * the modules (SkillModulesToken) and passes the registry to createAgent. A
 * bad module fails composition with agent.skill_invalid, every problem in
 * `detail`, as tools do. The agent core never names a domain skill.
 */
import {
  createToken,
  err,
  ok,
  skillModuleProblems,
  type AnySkill,
  type Result,
  type SkillModule,
} from '@taalcut/core';
import type { ToolCatalogue } from '@taalcut/tools';
import { z } from 'zod';
import { SkillInvalid } from './errors';

/** The skill modules the composition root composes (templates, timeline, render). The agent is the only consumer. */
export const SkillModulesToken = createToken<readonly SkillModule[]>('agent.skillModules');

export interface SkillRegistry {
  get(id: string): AnySkill | undefined;
  /** Every skill, by id. */
  list(): AnySkill[];
  /** Is this tool (canonical name, e.g. 'timeline.cast') one the skill may load and call? */
  allows(skill: AnySkill, tool: string): boolean;
  /** The subset's tool names, sorted. */
  subset(skill: AnySkill): string[];
}

/** Checks every module against core's rules and the tool registry; registers nothing if anything is wrong. */
export function createSkillRegistry(
  modules: readonly SkillModule[],
  tools: Pick<ToolCatalogue, 'catalogue' | 'describe'>,
): Result<SkillRegistry> {
  const problems: string[] = [];
  const skills = new Map<string, AnySkill>();
  const moduleIds = new Set<string>();
  for (const module of modules) {
    if (moduleIds.has(module.id)) problems.push(`module '${module.id}': registered twice`);
    moduleIds.add(module.id);
    problems.push(...skillModuleProblems(module));
    for (const skill of module.skills) {
      if (skills.has(skill.id)) problems.push(`${skill.id}: declared by two modules`);
      skills.set(skill.id, skill);
      problems.push(...toolProblems(skill, tools), ...outputProblems(skill));
    }
  }
  if (problems.length > 0) {
    return err(
      SkillInvalid(
        { module: modules.map((m) => m.id).join(', ') },
        { detail: [...new Set(problems)].join('\n') },
      ),
    );
  }
  return ok(registryOver(skills, tools));
}

/** A registry with no skills: Phase 1 runs, tests. */
export function emptySkillRegistry(): SkillRegistry {
  return registryOver(new Map(), { catalogue: () => [], describe: () => undefined });
}

function registryOver(
  skills: ReadonlyMap<string, AnySkill>,
  tools: Pick<ToolCatalogue, 'catalogue' | 'describe'>,
): SkillRegistry {
  const allows = (skill: AnySkill, tool: string) => {
    if (skill.tools.names?.includes(tool)) return true;
    const family = tools.describe(tool)?.family;
    return family !== undefined && (skill.tools.families?.includes(family) ?? false);
  };
  return {
    get: (id) => skills.get(id),
    list: () => [...skills.values()].sort((a, b) => a.id.localeCompare(b.id)),
    allows,
    subset(skill) {
      const names = new Set(skill.tools.names ?? []);
      for (const family of skill.tools.families ?? [])
        for (const entry of tools.catalogue({ families: [family] })) names.add(entry.name);
      return [...names].filter((name) => tools.describe(name) !== undefined).sort();
    },
  };
}

function toolProblems(skill: AnySkill, tools: Pick<ToolCatalogue, 'catalogue' | 'describe'>): string[] {
  const problems: string[] = [];
  for (const name of skill.tools.names ?? [])
    if (!tools.describe(name)) problems.push(`${skill.id}: tool '${name}' is not registered`);
  for (const family of skill.tools.families ?? [])
    if (tools.catalogue({ families: [family] }).length === 0)
      problems.push(`${skill.id}: no registered tool is in family '${family}'`);
  return problems;
}

/** The handoff is the handOff pseudo-tool's parameters, so it must be a JSON Schema object. */
function outputProblems(skill: AnySkill): string[] {
  try {
    const schema = z.toJSONSchema(skill.output, { io: 'input' }) as { type?: unknown };
    return schema.type === 'object' ? [] : [`${skill.id}: output must convert to a JSON Schema object`];
  } catch {
    // skillModuleProblems already says why.
    return [];
  }
}
