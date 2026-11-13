// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pseudo-tools the agent handles itself: they never reach the tool executor.
 * Their names have no underscore, so they can't collide with registry call
 * names ('family_name').
 */
import type { ArtifactStore } from '@taalcut/core';
import type { ToolSpec } from '@taalcut/models';
import type { ToolRegistry } from '@taalcut/tools';
import { z } from 'zod';
import type { PlanStep } from './events';
import { findTools, metaLines, refusedLine } from './find-tools';
import { readArtifact, readInput } from './artifact-reader';

export const PLAN_TOOL = 'updatePlan';
export const FIND_TOOL = 'findTools';
export const READ_ARTIFACT_TOOL = 'readArtifact';
/** Phase 2 (skill-tools.ts): a skill's result, a skill's question, and starting a flow. */
export const HAND_OFF_TOOL = 'handOff';
export const ASK_USER_TOOL = 'askUser';
export const START_FLOW_TOOL = 'startFlow';
export const META_TOOLS: readonly string[] = [
  PLAN_TOOL,
  FIND_TOOL,
  READ_ARTIFACT_TOOL,
  HAND_OFF_TOOL,
  ASK_USER_TOOL,
  START_FLOW_TOOL,
];

const MAX_STEPS = 12;

const planSteps = <S extends z.ZodObject>(step: S) =>
  z.object({
    steps: z
      .array(step)
      .min(1)
      .max(MAX_STEPS)
      .describe('The steps, in order. Keep ids from the current plan when you revise it.'),
  });
const basePlanStep = z.object({ id: z.string().optional(), text: z.string().min(1) });
/** With skills registered, a step may name one (and its input). Without, the Phase 1 schema, unchanged. */
const planInput = planSteps(
  basePlanStep.extend({
    skill: z.string().optional().describe('A skill from the catalogue this step runs'),
    input: z.record(z.string(), z.unknown()).optional().describe("The skill's input"),
  }),
);
const findInput = z.object({ query: z.string().min(1).describe('What you need to do, in plain words') });

export const planToolSpec: ToolSpec = {
  name: PLAN_TOOL,
  description:
    'Saves or revises your plan: the steps you will take, in order. Shown to the user as a checklist.',
  parameters: planSteps(basePlanStep),
};
/** updatePlan when skills are registered: a step may run one. */
export const skillPlanToolSpec: ToolSpec = { ...planToolSpec, parameters: planInput };
export const findToolSpec: ToolSpec = {
  name: FIND_TOOL,
  description:
    'Searches the tool catalogue and loads the best matches so you can call them on your next turn.',
  parameters: findInput,
};
export const readArtifactSpec: ToolSpec = {
  name: READ_ARTIFACT_TOOL,
  description: 'Reads part of a stored artifact (a large tool result) as text, a page at a time.',
  parameters: z.object({
    id: z.string().describe('Artifact id from a tool result'),
    offset: z.number().int().nonnegative().default(0),
    limit: z
      .number()
      .int()
      .positive()
      .max(8 * 1024)
      .default(8 * 1024),
  }),
};
/** A measured context can replace inline data with a handle; its reader advertises exact section selection. */
export const selectedReadArtifactSpec: ToolSpec = {
  name: READ_ARTIFACT_TOOL,
  description:
    'Reads exact stored data, a page at a time. Use a JSON Pointer path to read only the section needed.',
  parameters: readInput,
};

/** updatePlan's answer in a skill step: the list is the step's own, kept in its turns, not added to the run's plan. */
export const STEP_PLAN_NOTE =
  "Noted as this step's own checklist. Do it here with this step's tools, then hand off; Taalcut runs the next steps.";

export type MetaOutcome =
  | { readonly ok: true; readonly text: string; readonly steps?: PlanStep[]; readonly loaded?: string[] }
  | { readonly ok: false; readonly code: string; readonly detail: string };

export interface MetaDeps {
  readonly registry: Pick<ToolRegistry, 'search' | 'catalogue'>;
  readonly artifacts?: ArtifactStore;
  readonly currentPlan: readonly PlanStep[] | undefined;
  /** Skills a step may name. */
  readonly skills?: { get(id: string): unknown; list?(): readonly { readonly id: string }[] };
  /** In a skill step: findTools searches only the skill's tools. */
  readonly allowed?: (tool: string) => boolean;
  /** In a skill step: the skill running, which may not plan skills (the flow runs the next ones). */
  readonly skill?: string;
  /** AGT1: whether a name is a registry tool (a plan step naming one as its skill). */
  readonly isTool?: (name: string) => boolean;
  /** AGT2: how many tools one findTools call loads: the step's offer (tool-offer.ts `search`). Default 5. */
  readonly findLimit?: number;
  /** AGT1: the artifacts the run's tools stored, newest first (readArtifact's refusal names them). */
  readonly storedArtifacts?: () => readonly { readonly id: string; readonly summary: string }[];
  readonly loggedResult?: (id: string) => { readonly value: unknown } | undefined;
  readonly pageTokens?: number;
}

export async function runMetaTool(name: string, input: unknown, deps: MetaDeps): Promise<MetaOutcome> {
  if (name === PLAN_TOOL) {
    const parsed = planInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    // AGT1: a tool named as a step's skill (the 4B planned templates.fetchReference) is a plain step: call it.
    const tools = parsed.data.steps.flatMap((s) =>
      s.skill && !deps.skills?.get(s.skill) && deps.isTool?.(s.skill) ? [s.skill] : [],
    );
    const steps = parsed.data.steps.map((s) =>
      s.skill && tools.includes(s.skill) ? { ...s, skill: undefined } : s,
    );
    const asTools = tools.length > 0 ? ` ${toolsNote(tools)}` : '';
    const unknown = steps.find((s) => s.skill && !deps.skills?.get(s.skill));
    if (unknown)
      return {
        ok: false,
        code: 'agent.skill_not_found',
        detail: `No skill ${unknown.skill}. A step's skill is one of: ${skillNames(deps)}; leave it out for a step you do with tools.`,
      };
    // BRK1-MAKE: a skill step's own to-do list stays in the step. Appended to the run's plan, the owner's local
    // Librarian's four steps ("Ask the user how many variants", "Cast the library…") ran again after the flow had
    // ended, and the run failed with models.context_too_long after its QA card. AGT1: a skill named in it (which
    // would have run after the flow with no input) is left out with a note, not refused: nothing is stored.
    if (deps.skill) {
      const named = [...new Set(steps.flatMap((s) => (s.skill ? [s.skill] : [])))];
      const left =
        named.length > 0
          ? ` You are running ${deps.skill}: ${named.join(', ')} ${named.length > 1 ? 'are' : 'is'} left out of your list, because Taalcut runs the flow's next steps. Do this step's work and hand off.`
          : '';
      return { ok: true, text: `${STEP_PLAN_NOTE}${asTools}${left}` };
    }
    const violation = flowViolation(deps.currentPlan, steps);
    if (violation) return { ok: false, code: 'agent.flow_violation', detail: violation };
    const taken = new Set((deps.currentPlan ?? []).map((s) => s.id));
    let next = 1;
    const saved = steps.map((s) => {
      const extra = { ...(s.skill ? { skill: s.skill } : {}), ...(s.input ? { input: s.input } : {}) };
      if (s.id) return { id: s.id, text: s.text, ...extra };
      while (taken.has(`s${next}`)) next++;
      taken.add(`s${next}`);
      return { id: `s${next}`, text: s.text, ...extra };
    });
    return { ok: true, text: `Plan saved: ${saved.length} step(s).${asTools}`, steps: saved };
  }
  if (name === FIND_TOOL) {
    const parsed = findInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    // FIX-CMT: ranked within what the step may call, a named tool first, a family's word its tools (find-tools.ts).
    const found = findTools(
      parsed.data.query,
      deps.registry,
      deps.allowed ?? (() => true),
      deps.findLimit ?? 5,
    );
    const { hits } = found;
    const loaded = hits.map((h) => h.name);
    const meta = metaLines(found, deps.skill);
    const refused = refusedLine(found, deps.skill);
    const text = [
      ...(hits.length > 0
        ? [`Loaded for your next turn:\n${hits.map((h) => `${h.name}: ${h.summary}`).join('\n')}`]
        : meta.length === 0
          ? ['No tool matches. Try other words, or do the step without a tool.']
          : []),
      ...meta,
      ...(refused ? [refused] : []),
    ].join('\n');
    return { ok: true, text, loaded };
  }
  const parsed = readInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return readArtifact(parsed.data, { ...deps, noArtifact: (id) => noArtifact(id, deps) });
}

/**
 * A flow's steps keep their order and none is dropped: a plan that names any
 * of them must name all of them, in order. A plan naming none adds its steps.
 */
function flowViolation(
  current: readonly PlanStep[] | undefined,
  given: readonly { readonly id?: string | undefined }[],
): string | undefined {
  const flowIds = (current ?? []).filter((s) => s.flow).map((s) => s.id);
  const named = given.map((s) => s.id).filter((id): id is string => id !== undefined && flowIds.includes(id));
  if (named.length === 0 || named.join() === flowIds.join()) return undefined;
  return `Keep the flow's steps (${flowIds.join(', ')}) in their order; add yours before or after them.`;
}

/** AGT1: a tool named as a skill was kept as a plain step; say how to call it. */
const toolsNote = (tools: readonly string[]) =>
  `${tools.join(', ')} ${tools.length > 1 ? 'are tools' : 'is a tool'}, not a skill: the step is kept without one. Call ${tools.length > 1 ? 'them' : 'it'} directly.`;

function skillNames(deps: MetaDeps): string {
  const list = deps.skills?.list?.();
  return list && list.length > 0 ? list.map((s) => s.id).join(', ') : 'none here';
}

/**
 * AGT1: an id readArtifact doesn't have (MLX1's make runs asked for the breakdown's id twice): the run's artifacts by
 * id, or that there are none, and where other ids go.
 */
function noArtifact(id: string, deps: MetaDeps): string {
  const stored = deps.storedArtifacts?.() ?? [];
  const known =
    stored.length > 0
      ? `The artifacts this run stored: ${stored
          .slice(0, 5)
          .map((a) => `${a.id} (${a.summary})`)
          .join('; ')}.`
      : 'This run has stored no artifact: every result so far came back whole.';
  return `No artifact ${id.slice(0, 40)}. ${known} An id another tool returned (a breakdown, a template, a timeline) is not an artifact: pass it to the tool that takes it.`;
}

function invalid(error: z.ZodError): MetaOutcome {
  return { ok: false, code: 'tools.invalid_input', detail: z.prettifyError(error) };
}
