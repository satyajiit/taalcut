// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Flow extensions (SPEC section 25): optional flow steps that register themselves instead of new arms in
 * flows.ts. Each is anchored after (or before) a flow step; when the anchor finishes (or is about to start)
 * it is asked once whether its step joins, and its answer is logged (flow.extensionChecked, then
 * flow.extended with the facts it decided on), so a resumed run never asks again and a replay reads the
 * answer instead of asking. The model still may not drop or reorder skill steps.
 */
import {
  createToken,
  err,
  ok,
  type AsyncResult,
  type Card,
  type Result,
  type SkillQuestion,
} from '@taalcut/core';
import { FlowExtensionInvalid } from '../errors';
import type { AutonomyLevel } from '../events';
import { FLOW_SKILLS } from '../flows';
import type { RunState, StepState } from '../run-state';
import type { SkillRegistry } from '../skills';

/** The step an extension adds: a skill step, or one tool call the agent makes itself. */
export interface FlowExtensionStep {
  readonly skill?: string;
  readonly tool?: string;
  /** i18n key of the step's name on the plan. */
  readonly labelKey: string;
}

export interface FlowExtensionContext {
  /** The anchor: the finished step for `after`, the step about to start for `before`. */
  readonly anchor: StepState;
  readonly projectId: string | undefined;
  readonly autonomy: AutonomyLevel;
  /** What the project's cap leaves to spend (US$); null when it has none. */
  budgetLeftUsd(): Promise<number | null>;
  readonly signal: AbortSignal;
}

export type FlowExtensionDecision =
  | { readonly join: false }
  | {
      readonly join: true;
      /** The facts the step is built from, logged with flow.extended (JSON). */
      readonly data?: unknown;
      /** A question to ask before the step runs: the run pauses for the answer. */
      readonly ask?: SkillQuestion;
    };

/** FIX-ASK: what `again` reads: its own step, about to start, and the context `when` had. */
export interface FlowExtensionAgainContext extends Omit<FlowExtensionContext, 'anchor'> {
  readonly step: StepState;
  /** The facts its latest round joined on. */
  readonly data: unknown;
}

export interface FlowExtensionCardInput {
  readonly state: RunState;
  /** The extension's step, once it is in the plan. */
  readonly step?: StepState;
  readonly data: unknown;
  /** While the question waits for the user. */
  readonly approvalId?: string;
  /** After the step handed off: its handoff. */
  readonly output?: unknown;
}

export interface FlowExtension {
  /** 'gaps', 'voice', 'voiceFinalize': also the flow key of the step it adds. */
  readonly id: string;
  readonly anchor: { readonly after: string } | { readonly before: string };
  readonly step: FlowExtensionStep;
  /** Whether the step joins; read from the log and through the extension's own ports. Asked once per anchor. */
  when(state: RunState, ctx: FlowExtensionContext): AsyncResult<FlowExtensionDecision>;
  /** The step's input beyond the flow's facts, from the logged data and the user's answers. */
  input?(state: RunState, step: StepState, data: unknown): Record<string, unknown>;
  /** Its cards: when the step joins (asking or not), and again after it hands off. */
  cards?(input: FlowExtensionCardInput): Card[];
  /**
   * BRK1-MAKE: the handoff its step gets from what is stored, when the model's still fails the check after its last
   * retry. The step's skill checks it like any handoff; one that passes is accepted (logged as settled) and the
   * flow goes on, so a step that only tidies the made video never fails the make. Undefined: the run fails.
   */
  settle?(state: RunState, step: StepState, signal: AbortSignal): AsyncResult<unknown | undefined>;
  /**
   * FIX-ASK: asked each time its step is about to start, after the step joined. Undefined (or `join: false`): the step
   * starts. A decision with data logs another round of the step's facts (flow.extended with `again`), its cards and,
   * when it asks, the question that pauses the run; the step starts once a pass answers undefined. The gaps step
   * waits for the person's new clips and casts the open gaps again here. Never asked in a replay.
   */
  again?(state: RunState, ctx: FlowExtensionAgainContext): AsyncResult<FlowExtensionDecision | undefined>;
}

/** One logged answer, as replay hands it back in order. */
export interface LoggedExtensionCheck {
  readonly extension: string;
  readonly anchorStepId: string;
  readonly joined: boolean;
  readonly data?: unknown;
}

/** What an agent composes: the extensions, and (replay only) the logged answers it uses instead of asking. */
/** One completed call of a step, as its settler reads it; `output` is undefined when the result was stored aside. */
export interface SettlerCall {
  readonly tool: string;
  readonly input: unknown;
  readonly output: unknown;
}

/** The handoff a step gets from what is stored, read from its completed calls; undefined: nothing to hand off. */
export type StepSettler = (
  calls: readonly SettlerCall[],
  signal: AbortSignal,
) => AsyncResult<unknown | undefined>;

export interface FlowExtensionDeps {
  readonly extensions: readonly FlowExtension[];
  readonly replayed?: () => LoggedExtensionCheck | undefined;
  /** Replay only: a step's logged settled handoff (BRK1-MAKE), instead of settling again. */
  readonly settled?: (stepId: string) => unknown;
  /**
   * By skill id: a step no extension added, settled as an extension's is (BRK1-MAKE) when its model's handoff never
   * passes the check. The skill checks the settled handoff like any other; one that fails, or undefined, and the run
   * fails as before. For a step whose handoff only reports what its tools stored (the Librarian's).
   */
  readonly settlers?: Readonly<Record<string, StepSettler>>;
}

export const FlowExtensionsToken = createToken<readonly FlowExtension[]>('agent.flowExtensions');

/** Anchors name a skill step of the flow tables (an extension's step is asked before a skill step starts). */
const ANCHOR_KEYS: ReadonlySet<string> = new Set(Object.keys(FLOW_SKILLS));

/** Everything wrong with the extensions, as developer-facing lines; empty: they compose. */
export function flowExtensionProblems(
  extensions: readonly FlowExtension[],
  skills: Pick<SkillRegistry, 'get'>,
  hasTool: (name: string) => boolean,
): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const extension of extensions) {
    const { id, step, anchor } = extension;
    if (ids.has(id)) problems.push(`${id}: registered twice`);
    ids.add(id);
    if (ANCHOR_KEYS.has(id)) problems.push(`${id}: the id is a flow step's key`);
    const key = 'after' in anchor ? anchor.after : anchor.before;
    if (!ANCHOR_KEYS.has(key)) problems.push(`${id}: anchor '${key}' is not a flow skill step`);
    if ((step.skill === undefined) === (step.tool === undefined))
      problems.push(`${id}: the step needs exactly one of skill and tool`);
    if (step.skill && !skills.get(step.skill)) problems.push(`${id}: skill ${step.skill} is not registered`);
    if (step.tool && !hasTool(step.tool)) problems.push(`${id}: tool ${step.tool} is not registered`);
  }
  return problems;
}

/** The extensions if they all compose, else agent.flow_extension_invalid with every problem in `detail`. */
export function composeFlowExtensions(
  extensions: readonly FlowExtension[],
  skills: Pick<SkillRegistry, 'get'>,
  hasTool: (name: string) => boolean,
): Result<FlowExtensionDeps> {
  const problems = flowExtensionProblems(extensions, skills, hasTool);
  if (problems.length > 0)
    return err(
      FlowExtensionInvalid(
        { extension: extensions.map((e) => e.id).join(', ') },
        { detail: problems.join('\n') },
      ),
    );
  return ok({ extensions: [...extensions] });
}
