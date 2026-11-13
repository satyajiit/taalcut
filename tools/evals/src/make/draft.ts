// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: eval:make's `render.draft`, with no pixels: render's own slot-match checks on the timeline as it is
 * (measure.ts, over the world's library and subject tracks). The draft is a render record with its QA report, so the
 * real video.done reads it.
 */
import { z } from 'zod';
import {
  ConflictError,
  defineTool,
  err,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
  type AnyTool,
  type ProjectId,
  type QaCheckResult,
  type QaReport,
  type RenderRecord,
  type RenderStore,
  type Timeline,
} from '@taalcut/core';
import { verdictOf } from '@taalcut/render';
import type { EvalTimelineStore } from '../edit/world';
import { fixedId } from '../edit/ids';

const SLOT_CHECKS = new Set<string>([
  'slotNeeds',
  'slotFace',
  'slotFraming',
  'slotMotion',
  'slotTiming',
  'slotGraphics',
]);

/** The drafts a run made, newest last; `list` is the render store's, for video.done. */
export interface EvalRenders extends Pick<RenderStore, 'list'> {
  readonly drafts: { readonly revision: number; readonly checks: readonly QaCheckResult[] }[];
}

export function evalRenders(): EvalRenders & { add(record: RenderRecord): void } {
  const records: RenderRecord[] = [];
  const drafts: EvalRenders['drafts'] = [];
  return {
    drafts,
    add(record) {
      records.push(record);
      drafts.push({ revision: record.timelineRevision, checks: record.qaReport?.checks ?? [] });
    },
    list: async (filter) =>
      ok(records.filter((record) => !filter?.projectId || record.projectId === filter.projectId)),
  };
}

const draftInput = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive().describe('The timeline revision to render (timeline.get has it)'),
});

export interface DraftToolDeps {
  readonly store: EvalTimelineStore;
  /** The slot checks of a timeline (measure.ts over the world's library). */
  readonly measure: (timeline: Timeline) => Promise<{ readonly checks: QaCheckResult[] }>;
  readonly renders: ReturnType<typeof evalRenders>;
}

export function evalDraftTool(deps: DraftToolDeps): AnyTool {
  let made = 0;
  return defineTool({
    name: 'render.draft',
    version: '1.1.0',
    summary: 'Renders a QA-checked draft of one timeline revision, before the export approval.',
    description:
      'Renders the timeline revision with the project export settings and runs every QA check on it, without ' +
      'asking. Returns the render, whether it passed QA, the failing checks with their fixes, and the slots that ' +
      'differ from the template (slotMatch) with theirs: each fix names the slot, what differs, by how much, and ' +
      'the tools that fix it.',
    tags: ['render', 'draft', 'qa', 'review', 'preview'],
    input: draftInput,
    output: z.object({
      renderId: z.string(),
      timelineRevision: z.int(),
      passed: z.boolean(),
      failing: z.array(z.unknown()),
      slotMatch: z.array(z.object({ id: z.string(), slots: z.int(), fixes: z.array(z.unknown()) })),
    }),
    costClass: 'local',
    sideEffect: 'write',
    timeoutMs: 30_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    run: async (input) => {
      const timeline = deps.store.read(input.timelineId);
      if (timeline.revision !== input.revision)
        return err(
          ConflictError(
            { entity: 'timeline', id: input.timelineId },
            {
              detail: `The timeline is at revision ${timeline.revision}, not ${input.revision}: draft that one`,
            },
          ),
        );
      const { checks } = await deps.measure(timeline);
      const id = fixedId<'Render'>('01K9MR', ++made);
      const verdict = verdictOf(checks, []);
      const report: QaReport = {
        version: 1,
        renderId: id,
        round: 1,
        verdict,
        presetId: 'reels',
        checks,
        overrides: [],
        createdAt: made,
      };
      deps.renders.add({
        id,
        projectId: input.projectId as ProjectId,
        timelineId: input.timelineId,
        timelineRevision: input.revision,
        status: 'ready',
        deletedAt: null,
        createdAt: made,
        qaReport: report,
      } as unknown as RenderRecord);
      const slotMatch = checks
        .filter((check) => SLOT_CHECKS.has(check.id) && (check.status === 'warn' || check.status === 'fail'))
        .map((check) => ({ id: check.id, slots: check.findings.length, fixes: check.fixes }));
      return ok({
        renderId: id,
        timelineRevision: input.revision,
        passed: verdict !== 'needsAttention',
        failing: [],
        slotMatch,
      });
    },
  }) as AnyTool;
}
