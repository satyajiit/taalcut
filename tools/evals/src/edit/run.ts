// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: one edit eval case, run through the real agent loop: the case's world (world.ts), the agent with the
 * Editor 2.0 as its only skill, a chat turn that plans the Editor's step as the editor's chat does (session.ts), and
 * the case's checker on the timeline it left. Malformed calls are the ones the registry couldn't run as written: an
 * input that doesn't fit the tool, a tool that isn't there, or one outside the step.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAgent,
  createCommandDispatcher,
  createEditorResolver,
  createMemoryEventLogStore,
  createSkillRegistry,
  editorBrief,
  parseSoul,
  type AgentEvent,
} from '@taalcut/agent';
import {
  GRAPHICS_DESIGN_TOOL,
  ok,
  unwrap,
  type CommandOrigin,
  type EditorContext,
  type GraphicsDesignJob,
  type Timeline,
} from '@taalcut/core';
import type { ModelClient, ModelResult } from '@taalcut/models';
import { createMemoryArtifactStore, createMemoryToolCache, createToolRegistry } from '@taalcut/tools';
import type { EditCase, EditFamily } from './case-types';
import { all, outOfTarget, proposedUnasked } from './check';
import { addComments, answered, openBatch } from './comments';
import { createSessionClient, type Session } from './session';
import { seconds, targetOf } from './targets';
import { editWorld } from './world';

const SOUL = parseSoul(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'SOUL.md'), 'utf8'));
const UI: CommandOrigin = { source: 'ui', actor: 'user' };
export const MALFORMED_CODES = ['tools.invalid_input', 'tools.not_found', 'agent.outside_skill'] as const;

export interface CaseCall {
  readonly tool: string;
  readonly ok: boolean;
  readonly error?: string;
  /** For reading a run: what the model sent, and why a call was refused. */
  readonly input?: unknown;
  readonly detail?: string;
}

export interface CaseRun {
  readonly caseId: string;
  readonly family: EditFamily;
  readonly pointed: boolean;
  readonly pass: boolean;
  readonly why: string;
  readonly outOfTarget: readonly string[];
  /** Graphics proposed (not committed) that the request wasn't about: reported, not out of target. */
  readonly proposed: readonly string[];
  readonly malformed: readonly CaseCall[];
  readonly calls: readonly CaseCall[];
  readonly status: string;
  /** The Editor's last words: its one- or two-line report. */
  readonly said: string;
  readonly turns: number;
}

/**
 * The Editor step's text as the agent writes it for a docked message (ctx's stepText): the words, then the kinds of
 * what the brief says they point at, "make this black and white (selected: clip)". The text searches the tools the
 * step loads.
 */
export function editStepText(edit: EditCase, timeline: Timeline): string {
  const brief = editorBrief(edit.request, contextOf(edit, timeline) as EditorContext, timeline);
  const kinds = [...new Set(brief.targets.map((target) => target.itemKind))];
  const words = edit.request.trim().slice(0, 200);
  return kinds.length > 0 ? `${words} (selected: ${kinds.join(', ')})` : words;
}

/** What the docked composer sends with the person's words: the playhead, the selection and the bed in view. */
export function contextOf(edit: EditCase, timeline: Timeline) {
  return {
    timelineId: timeline.id,
    revision: timeline.revision,
    playhead: seconds(edit.playhead ?? 0),
    selection: (edit.select ?? []).map((pick) => targetOf(pick, timeline)),
    visibleRange: { start: seconds(0), duration: seconds(12) },
  };
}

function callsOf(events: readonly AgentEvent[]): CaseCall[] {
  const failed = new Map<string, { code: string; detail?: string }>();
  for (const event of events)
    if (event.type === 'tool.failed')
      failed.set(event.payload.toolCallId, {
        code: event.payload.error.code,
        ...(event.payload.error.detail ? { detail: event.payload.error.detail.slice(0, 400) } : {}),
      });
  return events.flatMap((event) => {
    if (event.type !== 'tool.requested') return [];
    const error = failed.get(event.payload.toolCallId);
    return [
      {
        tool: event.payload.tool,
        ok: error === undefined,
        ...(error ? { error: error.code, ...(error.detail ? { detail: error.detail } : {}) } : {}),
        input: event.payload.input,
      },
    ];
  });
}

export interface CaseModel {
  readonly live?: ModelClient;
  readonly replay?: Session;
  /**
   * AGT2: the window the agent reads for the step's model, as the app's (model-windows.ts): it sizes the tool offer
   * (agent tool-offer.ts) and compaction. Absent: no window, the smallest offer and no compaction (before AGT2).
   */
  readonly window?: number;
}

export async function runCase(
  edit: EditCase,
  model: CaseModel,
): Promise<{ run: CaseRun; turns: ModelResult[] }> {
  const world = await editWorld();
  for (const step of edit.setup ?? []) {
    const done = await world.bus.dispatch(
      step.name,
      { projectId: world.projectId, timelineId: world.timelineId, ...step.payload },
      UI,
    );
    if (!done.ok) throw new Error(`${edit.id} setup ${step.name}: ${done.error.code}`);
  }
  const before = world.timeline();
  // A docked message, as the app sends it (agent SPEC 38): the run reads the brief (the note every turn ends with,
  // what the words point at), and its one step is the Editor's, with no planning turn. FIX-CMT: a comment case
  // sends its comments together instead (comments.ts), with no docked context.
  const commentIds = edit.comments ? await addComments(world, edit, before) : [];
  const sent = edit.comments
    ? { comments: await openBatch(world, commentIds) }
    : { editorContext: contextOf(edit, before) as EditorContext };
  const registry = unwrap(createToolRegistry([...world.modules]));
  const skills = unwrap(createSkillRegistry([...world.skills], registry));
  const client = createSessionClient(model);
  const log = createMemoryEventLogStore();
  const agent = createAgent({
    models: client,
    tools: registry,
    log,
    soul: SOUL,
    commands: createCommandDispatcher(world.bus),
    artifacts: createMemoryArtifactStore(),
    toolCache: createMemoryToolCache(),
    settings: { autonomy: 'autopilot', budget: {} },
    skills,
    phase3: { editor: createEditorResolver({ timeline: async () => ok(world.timeline()) }) },
    ...(model.window !== undefined ? { contextWindow: () => model.window } : {}),
  });
  const outcome = unwrap(
    await agent.run({ conversationId: edit.id, projectId: world.projectId, message: edit.request, ...sent }),
  );
  const events = unwrap(await log.read(outcome.runId));
  const failure = events.findLast((event) => event.type === 'run.failed');
  const after = world.timeline();
  // The Editor's calls: from its step on.
  const calls = callsOf(
    events.slice(
      Math.max(
        0,
        events.findIndex((event) => event.type === 'skill.entered'),
      ),
    ),
  );
  const asked = calls
    .filter((call) => call.ok && call.tool === GRAPHICS_DESIGN_TOOL)
    .map((call) => call.input as GraphicsDesignJob);
  const checked = edit.check(before, after, asked);
  const verdict = checked.pass && edit.comments ? all(...(await answered(world, commentIds))) : checked;
  const outside = outOfTarget(before, after, edit.scope);
  const malformed = calls.filter(
    (call) => call.error && (MALFORMED_CODES as readonly string[]).includes(call.error),
  );
  const said =
    [...client.turns]
      .reverse()
      .find((turn) => turn.text.trim() !== '')
      ?.text.trim() ?? '';
  const why = verdict.pass
    ? outside.length > 0
      ? `out of target: ${outside.join('; ')}`
      : 'ok'
    : verdict.why;
  return {
    run: {
      caseId: edit.id,
      family: edit.family,
      pointed: edit.pointed ?? false,
      pass: verdict.pass && outside.length === 0,
      why:
        failure?.type === 'run.failed'
          ? `${why}; run failed: ${[failure.payload.error.code, failure.payload.error.detail].filter(Boolean).join(': ')}`
          : why,
      outOfTarget: outside,
      proposed: proposedUnasked(before, after, edit.scope, asked),
      malformed,
      calls,
      status: outcome.status,
      said,
      turns: client.turns.length,
    },
    turns: client.turns,
  };
}
