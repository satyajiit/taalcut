// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-I1: the skill steps a recorded session holds, and what a skill step is offered now. The catalogue
 * (catalogue.ts) pins every tool the model may be offered, but not which of them a skill step gets: that is the
 * skill's own list. On a cloud model's window a skill step is offered every tool it allows (@taalcut/agent
 * tool-offer.ts `WHOLE_WINDOW`), so a skill that names a tool more (the Editor's plugin tools in P3-PLG1, its
 * listening tools in EAR1-A3) changes every request it makes, and its recordings stop matching. The desktop's
 * test/agent-catalogue.test.ts holds each recorded step to `skillStepOffer`, and scripts/refresh-catalogue.ts
 * brings the recordings to it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnySkill } from '@taalcut/core';
import { GATE_DEMO_FIXTURES, type RecordedSession } from './recorded-models';

/** The agent's own tools in a skill step's offer (meta-tools.ts, skill-tools.ts), and pi-ai's placeholder. */
export const OFFER_META_TOOLS: ReadonlySet<string> = new Set([
  'updatePlan',
  'findTools',
  'readArtifact',
  'handOff',
  'askUser',
  'startFlow',
  '__pi_deferred_placeholder__',
]);

/** handOff's description names its skill (skill-tools.ts `handOffSpec`). */
const HAND_OFF = /^Hands the (\S+) skill's result/;
/** The step's input, as the agent's user message gives it to the model. */
const SKILL_INPUT = '[Taalcut] Skill input: ';

export interface RecordedSkillStep {
  /** The request's place in the cassette. */
  readonly index: number;
  readonly skill: string;
  /** The input the step was entered with; undefined when the request doesn't show one. */
  readonly input: unknown;
  /** The registry tools it offers (call names), in order: the agent's own tools left out. */
  readonly offered: readonly string[];
}

interface RecordedTool {
  readonly name: string;
  readonly description?: string;
}
interface RecordedBody {
  readonly tools?: readonly RecordedTool[];
  readonly messages?: readonly { readonly content?: unknown }[];
}

const textsOf = (content: unknown): string[] =>
  typeof content === 'string'
    ? [content]
    : Array.isArray(content)
      ? content.flatMap((part: { type?: string; text?: unknown }) =>
          part?.type === 'text' && typeof part.text === 'string' ? [part.text] : [],
        )
      : [];

/** The last skill input the messages give (the step's own; earlier steps' come before it). */
function stepInput(body: RecordedBody): unknown {
  const text = (body.messages ?? [])
    .flatMap((message) => textsOf(message.content))
    .findLast((part) => part.startsWith(SKILL_INPUT));
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text.slice(SKILL_INPUT.length)) as unknown;
  } catch {
    return undefined;
  }
}

/** Every request of `session` made in a skill step (it offers handOff), in cassette order. */
export function recordedSkillSteps(
  session: RecordedSession,
  fixturesDir: string = GATE_DEMO_FIXTURES,
): RecordedSkillStep[] {
  const tape = JSON.parse(readFileSync(join(fixturesDir, session.cassette), 'utf8')) as {
    interactions: { request: { body: RecordedBody | null } }[];
  };
  return tape.interactions.flatMap(({ request }, index) => {
    const tools = request.body?.tools ?? [];
    const skill = HAND_OFF.exec(tools.find((tool) => tool.name === 'handOff')?.description ?? '')?.[1];
    if (!skill || !request.body) return [];
    const offered = tools.map((tool) => tool.name).filter((name) => !OFFER_META_TOOLS.has(name));
    return [{ index, skill, input: stepInput(request.body), offered }];
  });
}

/** What the skill withholds for this input; none when it declares none, or the input doesn't parse or throws. */
function withheldTools(skill: AnySkill, input: unknown): readonly string[] {
  if (!skill.withheldTools || input === undefined) return [];
  const parsed = skill.input.safeParse(input);
  if (!parsed.success) return [];
  try {
    return skill.withheldTools(parsed.data);
  } catch {
    return [];
  }
}

/**
 * The registry tools (canonical names) a skill step is offered on a cloud window, as the agent builds it
 * (skill-step.ts `wholeOffer`, skill-withheld.ts `withheldTools`): the tools the skill names, in their order, then
 * the rest of its subset, sorted, less what its input withholds.
 */
export function skillStepOffer(
  skills: { subset(skill: AnySkill): string[] },
  skill: AnySkill,
  input: unknown,
): string[] {
  const withheld = new Set(withheldTools(skill, input));
  const subset = skills.subset(skill).filter((name) => !withheld.has(name));
  const named = (skill.tools.names ?? []).filter((name) => subset.includes(name));
  return [...new Set([...named, ...subset])];
}
