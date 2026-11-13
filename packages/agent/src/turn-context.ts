// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What one model turn runs with: the system prompt, the tools offered and
 * the model module. The plan turn may start a flow; a skill step's turns see
 * only the skill's prompt and tools, plus handOff (and askUser when the skill
 * may ask), and its last turn handOff alone; every other turn is Phase 1's.
 */
import type { AnySkill } from '@taalcut/core';
import type { ModuleId, ToolSpec } from '@taalcut/models';
import type { RegisteredTool } from '@taalcut/tools';
import type { RunContext } from './context';
import { withEditor } from './editor/editor-brief';
import { withMemory } from './memory/memory-block';
import {
  findToolSpec,
  planToolSpec as basePlanSpec,
  readArtifactSpec,
  selectedReadArtifactSpec,
  skillPlanToolSpec,
} from './meta-tools';
import { routedAllows } from './router/gate';
import { offeredWhole, stepOffer } from './skill-offer';
import { COMPACT_TOOL_CATALOGUE, mainSystemPrompt, skillSystemPrompt } from './skill-prompt';
import { subsetCatalogue, wholeOffer } from './skill-step';
import { stepCatalogue } from './step-catalogue';
import type { StepState } from './run-state';
import { stepAllows, stepWithheld } from './skill-withheld';
import { askUserSpec, handOffSpec, runnablePaths, startFlowSpec } from './skill-tools';
import { stepTurnLimit } from './turn-limits';

export interface TurnContext {
  readonly system: string;
  readonly tools: ToolSpec[];
  readonly module: ModuleId;
  readonly skill?: AnySkill;
}

interface BoundedOffer {
  readonly tools: ToolSpec[];
}

export function turnContext(ctx: RunContext, phase: 'plan' | 'act', bounded?: BoundedOffer): TurnContext {
  const state = ctx.log.state;
  const finish = (system: string) => finishPrompt(ctx, system);
  // Phase 1 runs (no skills) send exactly the Phase 1 tool schemas.
  const planToolSpec = ctx.skills.list().length > 0 ? skillPlanToolSpec : basePlanSpec;
  if (phase === 'plan') return planningContext(ctx, planToolSpec, bounded);
  const step = state.plan?.[state.stepIndex];
  const skill = step?.skill ? ctx.skills.get(step.skill) : undefined;
  if (!skill) return plainContext(ctx, step, planToolSpec, bounded);
  const withheld = stepWithheld(skill, step);
  const offer = stepOffer(step);
  const whole = offeredWhole(skill, offer);
  // AGT2: a small window's catalogue lists the tools nearest the step's route (step-catalogue.ts).
  const catalogue = whole
    ? { entries: subsetCatalogue(ctx, skill, withheld), more: 0 }
    : stepCatalogue(ctx, skill, step?.query ?? '', offer.catalogue, withheld);
  const isLastTurn = step !== undefined && step.turns >= stepTurnLimit(skill, ctx.settings, step) - 1;
  const system = skillSystemPrompt(
    ctx.soul,
    skill,
    catalogue.entries,
    bounded ? isLastTurn : whole,
    catalogue.more,
    bounded !== undefined && !isLastTurn,
  );
  // The step's last turn (SPEC 35): what it made is handed off, not thrown away at the limit.
  if (isLastTurn)
    return {
      system: finish(`${system}\n\n${LAST_TURN_NOTE}`),
      tools: [handOffSpec(skill)],
      module: skill.module ?? 'agent',
      skill,
    };
  const tools = bounded?.tools ?? [
    planToolSpec,
    findToolSpec,
    readerSpec(ctx, skill.module ?? 'agent'),
    handOffSpec(skill),
    ...(skill.questions?.length ? [askUserSpec()] : []),
    ...skillSpecs(ctx, skill, step, whole ? undefined : offer.turn),
  ];
  // BRK1-MAKE: after a turn in words alone, one short nudge that names the step's own tools.
  const nudged = (step?.textTurns ?? 0) > 0 ? `${system}\n\n${textTurnNote(tools)}` : system;
  return { system: finish(nudged), tools, module: skill.module ?? 'agent', skill };
}

/** Every variant retains the recalled memory and the editor the message was sent from. */
function finishPrompt(ctx: RunContext, system: string): string {
  return withEditor(withMemory(system, ctx.log.state.started?.memory), ctx.log.state.started?.editor);
}

function planningContext(ctx: RunContext, planTool: ToolSpec, bounded?: BoundedOffer): TurnContext {
  const state = ctx.log.state;
  const editor = state.started?.editor;
  // A docked message starts the make flow only when its words ask for a new video.
  const flows = !state.flow && (!editor || editor.route === 'make');
  const paths = flows ? runnablePaths(ctx) : [];
  // FLOW_RULES distinguishes an excerpt from a reference by this capability. The plain step loads its schema.
  const shorts = ctx.registry.resolve('shorts.generate');
  const excerptCapability = shorts
    ? `\n\n# Tool catalogue\n\nshorts: shorts.generate: ${shorts.descriptor.summary}`
    : '';
  const system = bounded
    ? mainSystemPrompt(ctx.soul, [], ctx.skills.list(), paths.length > 0, { catalogue: false }) +
      excerptCapability
    : ctx.systemPrompt;
  return {
    system: finishPrompt(ctx, system),
    tools: [planTool, ...(paths.length > 0 ? [startFlowSpec(paths)] : [])],
    module: 'agent',
  };
}

function plainContext(
  ctx: RunContext,
  step: StepState | undefined,
  planTool: ToolSpec,
  bounded?: BoundedOffer,
): TurnContext {
  const plain = stepOffer(step);
  const selected = new Set(bounded?.tools.map((tool) => tool.name));
  const catalogue = ctx.registry.catalogue();
  const subset = bounded
    ? catalogue.filter((entry) => selected.has(ctx.registry.resolve(entry.name)?.descriptor.callName ?? ''))
    : catalogue;
  const baseSystem =
    bounded || plain.all
      ? mainSystemPrompt(ctx.soul, subset, ctx.skills.list(), !bounded && runnablePaths(ctx).length > 0, {
          catalogue: false,
        }) + (bounded ? `\n\n${COMPACT_TOOL_CATALOGUE}` : '')
      : ctx.systemPrompt;
  const isLastTurn = step !== undefined && step.turns >= stepTurnLimit(undefined, ctx.settings, step) - 1;
  return {
    system: finishPrompt(ctx, isLastTurn ? `${baseSystem}\n\n${PLAIN_LAST_TURN_NOTE}` : baseSystem),
    tools: bounded?.tools ?? [
      planTool,
      findToolSpec,
      readerSpec(ctx, 'agent'),
      ...loadedSpecs(ctx, () => true, plain.all ? Number.POSITIVE_INFINITY : plain.turn),
    ],
    module: 'agent',
  };
}

/** A skill step's model turns in a row with no tool call before the step ends (`LoopSettings.maxTextTurns`). */
export const MAX_TEXT_TURNS = 3;

const META_TOOLS = new Set([basePlanSpec.name, findToolSpec.name, readArtifactSpec.name]);

function readerSpec(ctx: RunContext, module: ModuleId): ToolSpec {
  return ctx.contextWindow?.(module) || ctx.log.state.plan?.[ctx.log.state.stepIndex]?.window
    ? selectedReadArtifactSpec
    : readArtifactSpec;
}

/**
 * The nudge after a text-only turn in a skill step (BRK1-MAKE): on acc's runs 8 and 9 the on-device model answered
 * in words turn after turn until a limit, and the breakdown made nothing. Names the step's tools, planning left out.
 */
export function textTurnNote(tools: readonly ToolSpec[]): string {
  const names = tools.map((tool) => tool.name).filter((name) => !META_TOOLS.has(name));
  return `# Use this step's tools

Your last answer called no tool, and this step only moves through its tools: ${names.join(', ')}. Call the one you need now. When the work is done, call handOff. Words alone do nothing here.`;
}

/** A skill step's last turn: handOff is the only tool left, so the step keeps what its earlier turns made. */
export const LAST_TURN_NOTE = `# Last turn

This is the step's last turn: handOff is the only tool left. Hand off what you have made, with the ids and facts your tools returned. If you made nothing to hand off, say so in one line.`;

/** A plain step's final turn: warn the model to finish and summarize cleanly without calling more tools. */
export const PLAIN_LAST_TURN_NOTE = `# Last turn

This is this step's final turn: do not call more tools. Finish now and reply with a clear, concise summary of what you completed or found.`;

/**
 * The registry tools a skill step offers: every tool it allows (offered whole: its named ones in their order, then
 * its families'), or the newest `loaded` of those its route and findTools loaded.
 */
function skillSpecs(
  ctx: RunContext,
  skill: AnySkill,
  step: StepState | undefined,
  loaded: number | undefined,
): ToolSpec[] {
  if (loaded !== undefined) return loadedSpecs(ctx, stepAllows(ctx, skill, step), loaded);
  const routed = routedAllows(ctx.log.state, ctx.registry);
  return wholeOffer(ctx, skill, stepWithheld(skill, step)).flatMap((name) => {
    const tool = ctx.registry.resolve(name);
    return tool && routed(tool.descriptor.name) ? [specOf(tool)] : [];
  });
}

/**
 * Registry tools loaded for this run (and allowed now, within a live route's family), as model tool specs: of the
 * newest `turn` loaded (tool-offer.ts), those the step allows.
 */
function loadedSpecs(ctx: RunContext, allowed: (name: string) => boolean, turn: number): ToolSpec[] {
  const routed = routedAllows(ctx.log.state, ctx.registry);
  return ctx.log.state.loadedTools.slice(-turn).flatMap((name) => {
    const tool = ctx.registry.resolve(name);
    if (!tool || !allowed(tool.descriptor.name) || !routed(tool.descriptor.name)) return [];
    return [specOf(tool)];
  });
}

/** A registered tool as a model request offers it. */
export function specOf(tool: RegisteredTool): ToolSpec {
  return {
    name: tool.descriptor.callName,
    description: tool.descriptor.description,
    parameters: tool.spec.input,
  };
}
