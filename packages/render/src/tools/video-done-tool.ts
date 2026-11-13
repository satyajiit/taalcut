// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `video.done` (AGT2-MATCH): the Maker's finish, as `design.done` is the Designer's. It reads the newest draft of the
 * timeline (render.draft's, or an export's: a finished render with its QA report) and refuses, with timeline's
 * `checkVideoDone`, while the draft is of another revision, while any slot fails a slot-match check without a stated
 * reason, or while a QA check fails that the person may not export over. The refusal says what differs on each failing
 * slot and which tools fix it. It changes nothing; the make flow offers the export approval once it passes.
 */
import { z } from 'zod';
import {
  defineTool,
  defineToolModule,
  err,
  NO_TOOL_RETRY,
  ok,
  qaCheckIdSchema,
  ulidSchema,
  ValidationError,
  type AnyTool,
  type AsyncResult,
  type ProjectId,
  type RenderRecord,
  type RenderStore,
  type TemplateRef,
  type TimelineId,
  type ToolModule,
} from '@taalcut/core';
import { checkVideoDone } from '@taalcut/timeline';
import type { TimelineAccess } from '../ports';

/** A render whose QA has run: what video.done reads as a draft. */
const FINISHED = new Set<RenderRecord['status']>(['ready', 'needsAttention']);

export const VIDEO_DONE_REASONS_MAX = 60;

export interface VideoDoneDeps {
  readonly store: Pick<RenderStore, 'list'>;
  readonly timelines: Pick<TimelineAccess, 'get'>;
  /** The template version's slot ids in order (their numbers); absent or null: V1's order. */
  readonly templateSlots?: (template: TemplateRef) => AsyncResult<readonly string[] | null>;
  /** AGT2: where a pass's reasons are kept, so the Maker's own check holds the handoff to the same verdict. */
  readonly ledger?: VideoDoneLedger;
}

type DoneReasons = z.output<typeof videoDoneInputSchema>['reasons'];

/**
 * The reasons each timeline's last passing `video.done` gave, per process: the Maker's check (`makerDone`) reads them,
 * so a slot the AI left with a reason isn't refused again at the handoff.
 */
export interface VideoDoneLedger {
  record(timelineId: string, reasons: NonNullable<DoneReasons>): void;
  reasons(timelineId: string): NonNullable<DoneReasons>;
}

export function createVideoDoneLedger(max = 200): VideoDoneLedger {
  const kept = new Map<string, NonNullable<DoneReasons>>();
  return {
    record(timelineId, reasons) {
      kept.delete(timelineId);
      kept.set(timelineId, reasons);
      if (kept.size > max) kept.delete(kept.keys().next().value as string);
    },
    reasons: (timelineId) => kept.get(timelineId) ?? [],
  };
}

export const videoDoneInputSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  reasons: z
    .array(
      z.object({
        slot: z.int().min(1).max(200).optional().describe('The slot number, from 1, as the fixes name it'),
        check: qaCheckIdSchema
          .optional()
          .describe('Or a failing check that is no slot’s, one the person may export over'),
        reason: z.string().trim().min(1).max(300).describe('Why it stays as it is, in one line'),
      }),
    )
    .max(VIDEO_DONE_REASONS_MAX)
    .optional()
    .describe(
      'A reason for each failing slot that must stay as it is (e.g. no clip in the library shows its need)',
    ),
});

export const videoDoneOutputSchema = z.object({
  renderId: z.string(),
  revision: z.int().positive(),
  /** The template's slots the draft was held to. */
  slots: z.int().nonnegative(),
  /** Failing slots left as they are, with a reason. */
  waived: z.array(z.int().positive()),
  /** False when the slot checks measured nothing (the draft wasn't compared with its reel). */
  compared: z.boolean(),
});

/** The timeline's newest finished render: its draft. */
async function newestDraft(deps: VideoDoneDeps, projectId: string, timelineId: string) {
  const renders = await deps.store.list({ projectId: projectId as ProjectId, limit: 200 });
  if (!renders.ok) return renders;
  const drafts = renders.value
    .filter(
      (render) =>
        render.timelineId === timelineId && render.deletedAt === null && FINISHED.has(render.status),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  return ok(drafts[0] ?? null);
}

/** Slot ids in the template's order, else in V1's. */
async function slotOrder(deps: VideoDoneDeps, timeline: Awaited<ReturnType<TimelineAccess['get']>>) {
  if (!timeline.ok) return null;
  const ref = timeline.value.template;
  if (!ref) return null;
  const stored = deps.templateSlots ? await deps.templateSlots(ref) : null;
  if (stored?.ok && stored.value) return stored.value.map((id) => ({ id }));
  const v1 = timeline.value.tracks[0];
  const ids =
    v1?.kind === 'video'
      ? v1.items.flatMap((item) => (item.type !== 'transition' && item.slotId ? [item.slotId] : []))
      : [];
  return [...new Set(ids)].map((id) => ({ id: id as string }));
}

const verdictReason = (verdict: { verdict: string; reason?: string }) =>
  'reason' in verdict && verdict.reason ? verdict.reason : 'The draft does not pass yet.';

/** checkVideoDone over the timeline's newest draft, with these reasons. */
async function judge(
  deps: VideoDoneDeps,
  projectId: string,
  timeline: Awaited<ReturnType<TimelineAccess['get']>> & { ok: true },
  reasons: NonNullable<DoneReasons>,
) {
  const draft = await newestDraft(deps, projectId, timeline.value.id);
  if (!draft.ok) return draft;
  const found = draft.value;
  const outcome = checkVideoDone({
    timeline: timeline.value,
    slots: await slotOrder(deps, timeline),
    draft: found
      ? { renderId: found.id, timelineRevision: found.timelineRevision, report: found.qaReport }
      : null,
    reasons,
  });
  return ok({ outcome, found });
}

/**
 * AGT2: the Maker's done-gate (timeline's `MakerSkillDeps.done`): `video.done`'s verdict on the timeline as handed
 * off, with the reasons its last passing call gave. A handoff whose revision isn't the timeline's is refused by the
 * Maker's own check first.
 */
export function makerDone(
  deps: VideoDoneDeps,
): (handoff: { timelineId: string; revision: number }) => AsyncResult<{ passed: boolean; reason?: string }> {
  return async (handoff) => {
    const timeline = await deps.timelines.get(handoff.timelineId as TimelineId);
    if (!timeline.ok) return timeline;
    const reasons = deps.ledger?.reasons(handoff.timelineId) ?? [];
    const judged = await judge(deps, timeline.value.projectId, timeline, reasons);
    if (!judged.ok) return judged;
    const { verdict } = judged.value.outcome;
    return ok(
      verdict.verdict === 'pass'
        ? { passed: true }
        : {
            passed: false,
            reason: `${verdictReason(verdict)} Call video.done (with a reason for each slot that must stay), then hand off.`,
          },
    );
  };
}

export function videoDoneTool(deps: VideoDoneDeps): AnyTool {
  return defineTool({
    name: 'video.done',
    version: '1.0.0',
    summary:
      'Finishes the make: the newest draft must match its template and pass QA, or say why a slot stays.',
    description:
      'Ends the make once the newest draft (render.draft) is of the timeline as it is and passes: every slot ' +
      'matches the reel (slotNeeds, slotFace, slotFraming, slotMotion, slotTiming, slotGraphics) and no other QA ' +
      'check fails. It refuses while one fails, saying what differs on each slot and the tools that fix it. A ' +
      'slot that must stay as it is (no clip in the library shows its need) passes with a reason by its number.',
    tags: ['done', 'finish', 'match', 'template', 'reel', 'qa', 'slots'],
    input: videoDoneInputSchema,
    output: videoDoneOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 30_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    idempotencyKey: (input) => JSON.stringify(['video.done', input.timelineId, input.reasons ?? []]),
    summarize: (output) =>
      `Done: draft ${output.renderId} of revision ${output.revision}` +
      (output.waived.length > 0 ? `, slots ${output.waived.join(', ')} left with a reason` : '') +
      (output.compared ? '' : ' (not compared with its reel)'),
    run: async (input) => {
      const timeline = await deps.timelines.get(input.timelineId as TimelineId);
      if (!timeline.ok) return timeline;
      const judged = await judge(deps, input.projectId, timeline, input.reasons ?? []);
      if (!judged.ok) return judged;
      const { outcome, found } = judged.value;
      if (outcome.verdict.verdict !== 'pass' || !found)
        return err(ValidationError({ field: 'draft' }, { detail: verdictReason(outcome.verdict) }));
      deps.ledger?.record(input.timelineId, input.reasons ?? []);
      return ok({
        renderId: found.id,
        revision: found.timelineRevision,
        slots: outcome.slots,
        waived: [...outcome.waived],
        compared: outcome.compared,
      });
    },
  }) as AnyTool;
}

/** The `video` module: the Maker's finish (the loop lane's Maker lists it by name). */
export function videoToolModule(deps: VideoDoneDeps): ToolModule {
  return defineToolModule({ id: 'video', tools: [videoDoneTool(deps)] });
}
