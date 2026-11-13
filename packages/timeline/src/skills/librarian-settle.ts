// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Librarian's handoff reports what its timelines store: which template they were cast from, their ids and
 * revisions, how many slots sit under the confidence line and how many were reranked. The check holds each of those
 * to the stored cast (skills.ts, checkCast), so a model that assembled and then handed off something else can be
 * settled from the stored timelines without choosing anything for it. 0.1.0's installed run (Qwen3.5 4B at
 * 12,288 tokens) assembled the video and then handed off the cast's id in place of the timeline's, twice, and the
 * make failed with the video made. The agent asks a settler only after the model's own handoff never passed
 * (agent SPEC, BRK1-MAKE), and the skill checks what it answers.
 */
import { ok, type AsyncResult, type Timeline, type TimelineId } from '@taalcut/core';
import type { TimelineService } from '../service/service';

/** Slots under the confidence line, over every timeline: what the handoff's lowConfidenceSlots must say. */
export function lowConfidenceSlots(timelines: readonly Timeline[]): number {
  return timelines.reduce(
    (sum, timeline) => sum + (timeline.cast?.slots.filter((slot) => slot.needsRerank).length ?? 0),
    0,
  );
}

/**
 * AGT2: the slots the assembly reordered by the handed-off rerank are marked so in the stored cast; the most of any
 * one timeline is what the handoff's reranked must say.
 */
export function rerankedSlots(timelines: readonly Timeline[]): number {
  return Math.max(
    0,
    ...timelines.map(
      (timeline) => timeline.cast?.slots.filter((slot) => slot.note === 'reranked').length ?? 0,
    ),
  );
}

/** A step's completed call as the agent hands it to a settler (agent flows/extensions.ts, SettlerCall). */
interface CompletedCall {
  readonly tool: string;
  readonly input: unknown;
  readonly output: unknown;
}

const ASSEMBLE_TOOLS: ReadonlySet<string> = new Set(['timeline.assemble']);

function assembledIds(calls: readonly CompletedCall[]): TimelineId[] {
  const assembled = calls.findLast((call) => ASSEMBLE_TOOLS.has(call.tool));
  const output = assembled?.output;
  if (output === null || typeof output !== 'object' || !('timelineIds' in output)) return [];
  const ids = output.timelineIds;
  return Array.isArray(ids) ? ids.filter((id): id is TimelineId => typeof id === 'string') : [];
}

/**
 * The handoff of the step's last timeline.assemble, read from the stored timelines; undefined when the step
 * assembled nothing, a timeline can't be read or the timelines name no one template: the run fails as it did.
 */
export function librarianSettler(deps: { readonly service: Pick<TimelineService, 'read'> }) {
  return async (calls: readonly CompletedCall[]): AsyncResult<unknown | undefined> => {
    const ids = assembledIds(calls);
    if (ids.length === 0) return ok(undefined);
    const timelines: Timeline[] = [];
    for (const id of ids) {
      const timeline = await deps.service.read(id);
      if (!timeline.ok) return ok(undefined);
      timelines.push(timeline.value);
    }
    const templates = new Set(timelines.map((timeline) => timeline.template?.id));
    const [templateId] = templates;
    if (templates.size !== 1 || templateId === undefined) return ok(undefined);
    return ok({
      templateId,
      timelineIds: ids,
      revisions: timelines.map((timeline) => timeline.revision),
      lowConfidenceSlots: lowConfidenceSlots(timelines),
      reranked: rerankedSlots(timelines),
    });
  };
}
