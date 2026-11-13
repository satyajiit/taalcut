// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Flows (SPEC section 13): the fixed order of skills for each way in, as
 * data. Each step names a skill (or, for the export, the tool the agent calls
 * itself); its input is built from the facts the run knows so far (the start,
 * the project, earlier handoffs) and the skill's input schema keeps what it
 * needs, so a skill reads the current state, the user's edits included.
 */
import {
  defineSkill,
  defineSkillModule,
  type AnySkill,
  type OpeningPath,
  type SkillModule,
} from '@taalcut/core';
import { z } from 'zod';
import type { PlanStep } from './events';
import type { FlowStepInfo } from './flow-events';
import type { RunState, StepState } from './run-state';
import type { SkillRegistry } from './skills';
import { createGapsSkill } from './gaps/gap-skill';
import type { GapsDeps } from './gaps/gap-types';
import { OFFERED_FORMATS } from './offered-formats';

export const FLOW_SKILLS = {
  brief: 'agent.brief',
  analyst: 'templates.analyst',
  librarian: 'timeline.librarian',
  editor: 'timeline.editor',
  /** AGT2: the step that makes the video, where it is composed (maker-skill.ts in timeline): in place of the Editor. */
  maker: 'timeline.maker',
  reviewer: 'render.reviewer',
} as const;
export const EXPORT_TOOL = 'render.export';

export interface FlowStepDef {
  readonly key: keyof typeof FLOW_SKILLS | 'export';
  readonly skill?: string;
  readonly tool?: string;
  /** Runs once per variant once the Librarian has handed off more than one. */
  readonly perVariant?: boolean;
}

const TAIL: readonly FlowStepDef[] = [
  { key: 'editor', skill: FLOW_SKILLS.editor, perVariant: true },
  { key: 'reviewer', skill: FLOW_SKILLS.reviewer, perVariant: true },
  { key: 'export', tool: EXPORT_TOOL, perVariant: true },
];

/** AGT2: the Maker's step, which owns edit, draft, compare, fix and done in one context. */
const MAKER_DEF: FlowStepDef = { key: 'maker', skill: FLOW_SKILLS.maker, perVariant: true };

/** The keys of the steps that make the video (the Editor's, or the Maker's in its place). */
export const MAKE_KEYS: ReadonlySet<string> = new Set(['editor', 'maker']);

export const FLOWS: Readonly<Record<OpeningPath, readonly FlowStepDef[]>> = {
  reference: [
    { key: 'analyst', skill: FLOW_SKILLS.analyst },
    { key: 'librarian', skill: FLOW_SKILLS.librarian },
    ...TAIL,
  ],
  template: [{ key: 'librarian', skill: FLOW_SKILLS.librarian }, ...TAIL],
  describe: [{ key: 'librarian', skill: FLOW_SKILLS.librarian }, ...TAIL],
  library: [
    { key: 'brief', skill: FLOW_SKILLS.brief },
    { key: 'librarian', skill: FLOW_SKILLS.librarian },
    ...TAIL,
  ],
};

export const EXPORT_LABEL = 'flows.step.export';

/**
 * A path's steps as this composition runs them (AGT2): the Maker after the Librarian in place of the Editor, where
 * the Maker is registered; the Editor otherwise. The Reviewer stays the last gate before the export.
 */
export function flowSteps(path: OpeningPath, skills: Pick<SkillRegistry, 'get'>): readonly FlowStepDef[] {
  if (!skills.get(FLOW_SKILLS.maker)) return FLOWS[path];
  return FLOWS[path].map((def) => (def.key === 'editor' ? MAKER_DEF : def));
}

/** What a flow needs that isn't registered (skills, the export tool). Empty: it can run. */
export function flowProblems(
  path: OpeningPath,
  skills: Pick<SkillRegistry, 'get'>,
  hasTool: (name: string) => boolean,
): string[] {
  return flowSteps(path, skills).flatMap((def) =>
    def.skill && !skills.get(def.skill)
      ? [`skill ${def.skill}`]
      : def.tool && !hasTool(def.tool)
        ? [`tool ${def.tool}`]
        : [],
  );
}

/** The seeded plan: one step per flow step, text empty and the label as a key (no model call). */
export function seedFlowPlan(path: OpeningPath, skills: Pick<SkillRegistry, 'get'>): PlanStep[] {
  return flowSteps(path, skills).map((def, index) =>
    flowStep(def, `f${index + 1}`, { key: def.key, variant: 1 }, skills),
  );
}

export function flowStep(
  def: FlowStepDef,
  id: string,
  flow: FlowStepInfo,
  skills: Pick<SkillRegistry, 'get'>,
): PlanStep {
  const labelKey = def.skill ? (skills.get(def.skill)?.labelKey ?? `skills.${def.skill}`) : EXPORT_LABEL;
  return {
    id,
    text: '',
    labelKey,
    flow,
    ...(def.skill ? { skill: def.skill } : {}),
    ...(def.tool ? { tool: def.tool } : {}),
  };
}

export function flowDef(key: string): FlowStepDef | undefined {
  return (
    TAIL.find((d) => d.key === key) ??
    (key === MAKER_DEF.key ? MAKER_DEF : undefined) ??
    Object.values(FLOWS)
      .flat()
      .find((d) => d.key === key)
  );
}

/** A new plan step id: s1, s2… are the model's, f1, f2… the flow's. */
export function nextFlowStepId(state: RunState, taken: Set<string> = new Set()): string {
  const used = new Set([...(state.plan ?? []).map((s) => s.id), ...taken]);
  let n = (state.plan?.length ?? 0) + 1;
  while (used.has(`f${n}`)) n++;
  return `f${n}`;
}

type Facts = Record<string, unknown>;
const record = (value: unknown): Facts =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Facts) : {};

/**
 * What the run knows when a flow step starts, as a superset of the skills'
 * inputs: the skill's own input schema keeps the fields it declares.
 */
export function flowFacts(state: RunState, step: StepState): Facts {
  const flow = state.flow;
  const variant = step.flow?.variant ?? 1;
  const facts: Facts = {};
  const projectId = flow?.projectId ?? state.started?.projectId;
  if (projectId) facts.projectId = projectId;
  if (flow?.start.path === 'reference') facts.reference = flow.start.reference;
  if (flow?.start.path === 'template') facts.templateId = flow.start.templateId;
  const brief = record(flow?.input?.brief);
  if (typeof brief.text === 'string') facts.brief = brief;
  else if (flow?.start.path === 'describe' && state.started?.message) {
    // A bundled format picked as the start comes with its id, so the brief needn't name it back.
    const formatId = flow.start.formatId;
    facts.brief = { text: state.started.message.trim().slice(0, 4000), ...(formatId ? { formatId } : {}) };
  }
  for (const done of state.plan ?? []) {
    if (!done.handedOff || done.id === step.id) continue;
    const output = record(done.handedOff.output);
    const sameVariant = (done.flow?.variant ?? 1) === variant;
    switch (done.flow?.key) {
      case 'brief':
        if (typeof output.text === 'string') facts.brief = output;
        break;
      case 'analyst':
        if (output.templateId) facts.templateId = output.templateId;
        if (typeof output.version === 'number') facts.templateVersion = output.version;
        if (typeof output.slotCount === 'number') facts.slotCount = output.slotCount;
        break;
      case 'librarian': {
        const ids = Array.isArray(output.timelineIds) ? output.timelineIds : [];
        const revisions = Array.isArray(output.revisions) ? output.revisions : [];
        if (ids[variant - 1]) facts.timelineId = ids[variant - 1];
        if (typeof revisions[variant - 1] === 'number') facts.revision = revisions[variant - 1];
        if (output.templateId) facts.templateId = output.templateId;
        break;
      }
      default:
        if (!sameVariant) break;
        if (output.timelineId) facts.timelineId = output.timelineId;
        if (typeof output.revision === 'number') facts.revision = output.revision;
        if (typeof output.version === 'number' && done.flow?.key === 'editor')
          facts.revision = output.version;
        if (output.renderId) facts.renderId = output.renderId;
    }
  }
  // AGT2: a review or export queued after a refused export reads the head it was queued at, unless a later
  // handoff (the Editor's rerun on the person's change) is newer.
  const head = step.flow?.revision;
  if (typeof head === 'number' && !(typeof facts.revision === 'number' && facts.revision >= head))
    facts.revision = head;
  if (typeof facts.revision === 'number') {
    facts.timelineRevision = facts.revision;
    facts.version = facts.revision;
  } else if (typeof facts.templateVersion === 'number') facts.version = facts.templateVersion;
  if (step.flow?.fixes) facts.fixes = step.flow.fixes;
  if (state.answers.variants !== undefined && step.flow?.key === 'librarian')
    facts.variants = state.answers.variants;
  // A copy request may include footage directions as a brief. Once its template exists, that is the casting
  // source; passing both selectors fails the Librarian's input contract. The request stays in the run history.
  if (step.flow?.key === 'librarian' && facts.templateId) delete facts.brief;
  return facts;
}

/** Merges handoff facts from earlier plan steps under an explicit plain-object step.input. */
export function stepSuppliedInput(state: RunState, step: StepState, ext: Facts): unknown {
  const hasHandoffs = (state.plan ?? []).some((s) => s.handedOff !== undefined && s.id !== step.id);
  if (step.input === undefined) return step.flow || hasHandoffs ? { ...flowFacts(state, step), ...ext } : {};
  if (step.input !== null && typeof step.input === 'object' && !Array.isArray(step.input)) {
    const facts = flowFacts(state, step);
    const merged: Facts = { ...facts, ...ext, ...(step.input as Facts) };
    if (
      hasHandoffs &&
      typeof facts.version === 'number' &&
      typeof merged.version === 'number' &&
      merged.version < facts.version
    ) {
      merged.version = facts.version;
    }
    return merged;
  }
  return step.input;
}

/** The library path's first step: a brief the agent proposes from the newest footage, which the user can change. */
export const briefSkill = defineSkill({
  id: FLOW_SKILLS.brief,
  version: '1.0.0',
  labelKey: 'skills.agent.brief',
  description: "Proposes a short brief for a video from the user's newest footage.",
  prompt: [
    "Look at the user's sources and files with the library tools and find the newest group of footage taken",
    'close together (one trip, one day, one event). Propose one short brief for a video made from it, in the',
    "user's language: what it is about, in one or two sentences. Hand off the brief; the user can change it.",
  ].join(' '),
  tools: { families: ['library'] },
  input: z.object({ projectId: z.string().min(1).max(64).optional() }),
  output: z.object({
    text: z.string().trim().min(1).max(500).describe("The brief, in the user's words and language"),
    formatId: z.enum(OFFERED_FORMATS).optional(),
    targetSeconds: z.int().min(6).max(120).optional(),
  }),
  refs: () => [],
});

/**
 * The agent's own skills: the library path's brief, and the gaps step (P3-B8) once its ports and drop's tool
 * are there. The composition root adds the module when library tools exist.
 */
export function agentSkillModule(options: { readonly gaps?: AgentGapsOptions } = {}): SkillModule {
  const gaps = options.gaps ? createGapsSkill(options.gaps.deps, options.gaps.registered) : undefined;
  return defineSkillModule({
    id: 'agent',
    skills: [briefSkill as unknown as AnySkill, ...(gaps ? [gaps] : [])],
  });
}

/** What the gaps skill needs: its ports, and which tools are registered (it offers only those). */
export interface AgentGapsOptions {
  readonly deps: GapsDeps;
  readonly registered: (tool: string) => boolean;
}
