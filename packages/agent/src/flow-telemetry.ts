// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's alpha telemetry (SPEC section 16, P2-X7) through core's
 * Telemetry port, which drops everything while consent is off or Local only
 * is on. Only enums, bounded counts, booleans and durations: never media,
 * text, file names or ids (the project goes as context, which the service
 * turns into a keyed hash).
 */
import {
  EXPORT_PRESET_IDS,
  MUSIC_PATHS,
  QA_CHECK_IDS,
  type QaCheckId,
  type TelemetryEvent,
} from '@taalcut/core';
import type { RunContext } from './context';
import type { FlowStepInfo } from './flow-events';
import { FLOW_SKILLS, MAKE_KEYS } from './flows';
import type { RunState, StepState } from './run-state';

/** The Reviewer's draft (render's tool): its output lists the failing QA checks. */
const DRAFT_TOOL = 'render.draft';

const count = (value: unknown, max = 1_000_000_000): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function send(ctx: Pick<RunContext, 'phase2'>, state: RunState, event: TelemetryEvent): void {
  // The service drops events while Local only is on; a local-only run doesn't send them in the first place.
  if (ctx.phase2.replay || state.started?.localOnly) return;
  const projectId = state.flow?.projectId ?? state.started?.projectId;
  try {
    ctx.phase2.telemetry.record(event, projectId ? { projectId: projectId as never } : undefined);
  } catch {
    // Telemetry never fails a run.
  }
}

export function emitFlowStarted(ctx: Pick<RunContext, 'phase2'>, state: RunState): void {
  if (state.flow) send(ctx, state, { name: 'flow.started', path: state.flow.path });
}

/** The inline output of the run's last completed call of `tool` that `match` accepts. */
function lastOutput(
  state: RunState,
  tool: string,
  match: (value: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  for (const id of [...state.toolCallOrder].reverse()) {
    const call = state.toolCalls[id];
    if (call?.requested.tool !== tool || call.outcome?.kind !== 'completed') continue;
    const output = call.outcome.payload.output;
    if (output.kind === 'inline' && match(record(output.value))) return record(output.value);
  }
  return undefined;
}

const isCheck = (id: unknown): id is QaCheckId => (QA_CHECK_IDS as readonly unknown[]).includes(id);

/** qa.result when the Reviewer hands off: the verdict, its round, and the draft's failing checks. */
function emitQaResult(ctx: RunContext, step: StepState, o: Record<string, unknown>): void {
  const state = ctx.log.state;
  const variant = step.flow?.variant ?? 1;
  // Each fix round put an Editor step with fixes before this review (the next round's are after it).
  const plan = state.plan ?? [];
  const at = plan.findIndex((s) => s.id === step.id);
  const fixLoops = plan
    .slice(0, Math.max(0, at))
    .filter((s) => MAKE_KEYS.has(s.flow?.key ?? '') && s.flow?.variant === variant && s.flow.fixes).length;
  const draft = lastOutput(state, DRAFT_TOOL, (value) => record(value.render).id === o.renderId);
  const failing = Array.isArray(draft?.failing) ? draft.failing : [];
  const failed = [...new Set(failing.map((check) => record(check).id).filter(isCheck))];
  const passed = o.passed === true;
  send(ctx, state, { name: 'qa.result', passed, firstPass: passed && fixLoops === 0, fixLoops, failed });
}

/** breakdown.completed when the Analyst hands off; cast.completed when the Librarian does; qa.result when the Reviewer does. */
export function emitHandoffTelemetry(ctx: RunContext, step: StepState, output: unknown): void {
  const state = ctx.log.state;
  const o = record(output);
  const ms = step.entered ? count(ctx.now() - step.entered.at, 1_000_000_000_000) : 0;
  if (step.skill === FLOW_SKILLS.analyst) {
    send(ctx, state, { name: 'breakdown.completed', slots: count(o.slotCount), ms });
  } else if (step.skill === FLOW_SKILLS.librarian) {
    const variants = Array.isArray(o.timelineIds) ? o.timelineIds.length : 1;
    send(ctx, state, {
      name: 'cast.completed',
      slots: count(
        o.slotCount ??
          record(state.plan?.find((s) => s.flow?.key === 'analyst')?.handedOff?.output).slotCount,
      ),
      variants: Math.min(10, Math.max(1, variants)),
      lowConfidence: count(o.lowConfidenceSlots),
      reranked: count(o.reranked),
      ms,
    });
  } else if (step.skill === FLOW_SKILLS.reviewer) {
    emitQaResult(ctx, step, o);
  }
}

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  (values as readonly unknown[]).includes(value) ? (value as T) : undefined;

/**
 * export.completed once the flow's export step is done (gate criteria 1 and 2): the render from the
 * export's output, the slot provenance and first export from the desktop's FlowExportFacts.
 */
export async function emitExportCompleted(ctx: RunContext, step: StepState): Promise<void> {
  const state = ctx.log.state;
  if (ctx.phase2.replay || !ctx.phase2.exports || !state.flow) return;
  const call = step.toolCallId ? state.toolCalls[step.toolCallId] : undefined;
  const output = call?.outcome?.kind === 'completed' ? call.outcome.payload.output : undefined;
  const render = record(output?.kind === 'inline' ? record(output.value).render : undefined);
  const preset = oneOf(EXPORT_PRESET_IDS, render.presetId);
  const musicPath = oneOf(MUSIC_PATHS, render.music);
  const rate = record(render.rate);
  const { id: renderId, projectId, timelineId } = render;
  if (!preset || !musicPath) return;
  if (typeof renderId !== 'string' || typeof projectId !== 'string' || typeof timelineId !== 'string') return;
  let facts;
  try {
    facts = await ctx.phase2.exports.facts({ projectId, timelineId, renderId });
  } catch {
    return;
  }
  if (!facts) return;
  const fps = count(rate.num) / Math.max(1, count(rate.den));
  const seconds = fps > 0 ? Math.round(count(render.durationFrames) / fps) : 1;
  const finished = typeof render.finishedAt === 'number' ? render.finishedAt : ctx.now();
  send(ctx, state, {
    name: 'export.completed',
    firstExport: facts.firstExport,
    path: state.flow.path,
    preset,
    musicPath,
    slots: count(facts.slots),
    slotsKeptAi: count(facts.slotsKeptAi),
    slotsSwappedByUser: count(facts.slotsSwappedByUser),
    orderChanged: facts.orderChanged,
    breakdownEdited: facts.breakdownEdited,
    seconds: Math.min(600, Math.max(1, seconds)),
    renderMs: count(finished - count(render.createdAt), 1_000_000_000_000),
  });
}

/** cost.recorded: the flow's money by module, its estimates, and whether the cap stopped it. */
export function emitCostRecorded(
  ctx: Pick<RunContext, 'phase2'>,
  state: RunState,
  scope: 'export' | 'abandoned',
): void {
  if (!state.flow) return;
  const byModule: Record<string, number> = {};
  for (const [module, usd] of Object.entries(state.spend))
    if (usd > 0) byModule[module] = count(usd * 1_000_000);
  const estimate = Object.values(state.estimates).reduce((sum, e) => sum + e.recorded.estimate.usd, 0);
  send(ctx, state, {
    name: 'cost.recorded',
    scope,
    usdMicros: count(state.usage.usd * 1_000_000),
    estimateMicros: count(estimate * 1_000_000),
    byModule,
    capHit: Object.values(state.approvals).some((a) => a.request.limit === 'projectCap'),
  } as TelemetryEvent);
}

export type { FlowStepInfo };
