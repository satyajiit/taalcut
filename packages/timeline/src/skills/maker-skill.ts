// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Maker (AGT2, `timeline.maker`): after the Librarian, one step owns the make loop in one context: edit, render
 * a draft, compare it with the reel, fix, and finish with video.done. It has every edit tool the Editor has, the
 * draft and its QA, the frames of the draft and of the library, and the template in view. The flow's Reviewer stays
 * the last technical gate before the export approval. HFW1's Designer runs this loop for one graphic; the Maker runs
 * it for the whole video.
 *
 * Its tools are named, not taken by family, and only those registered here are listed: the eyes and match lanes'
 * tools (video.compare, library.frameAt, library.subjects, video.done) join the list by their fixed names once their
 * modules are composed, and the skill registers without them before.
 */
import {
  defineSkill,
  ok,
  qaFixSchema,
  RationalTime,
  ulidSchema,
  type AsyncResult,
  type SkillVerdict,
} from '@taalcut/core';
import { z } from 'zod';
import { cutsOffAnchor, timelineStats } from '../model/checks';
import type { TimelineService } from '../service/service';
import { EDITOR_GRAPHICS_TOOLS } from './editor-graphics';
import {
  AI_CONTEXT_TOOLS,
  FINISH_TOOL_NAMES,
  GENERATION_TOOL_NAMES,
  MAX_FIXES,
  REQUEST_TOOL_NAMES,
  SHARED_TOOL_NAMES,
  WORKSPACE_COMPOSITION_TOOLS,
  WORKSPACE_SHELL_TOOLS,
} from './editor-skill';
import { MAKER_PROMPT } from './maker-prompt';

export const MAKER_SKILL_ID = 'timeline.maker';

/** The tools the other AGT2 lanes add, by the names the plan fixed (its "Seams"): eyes' three and match's done. */
export const MAKER_SEAM_TOOLS = [
  'video.compare',
  'library.frameAt',
  'library.subjects',
  'video.done',
] as const;

/** The draft, its QA, the frames and the template: what the Editor never had. */
const MAKER_LOOK_TOOLS = [
  'render.draft',
  'render.getQaReport',
  'timeline.captureFrame',
  'templates.get',
  'vision.describeFrame',
  'library.findSimilar',
] as const;

/** Edits beyond the Editor's: captions and the energy of the cut. */
const MAKER_MORE_EDITS = [
  'captions.setEnabled',
  'captions.editText',
  'captions.setStyle',
  'captions.rebuild',
  'captions.translate',
  'timeline.planEnergyCurve',
  'timeline.applyEnergyCurve',
] as const;

const MAKER_BASE_TOOL_NAMES: readonly string[] = [
  ...new Set([
    ...SHARED_TOOL_NAMES,
    ...FINISH_TOOL_NAMES,
    ...REQUEST_TOOL_NAMES,
    ...EDITOR_GRAPHICS_TOOLS,
    ...MAKER_MORE_EDITS,
    ...GENERATION_TOOL_NAMES,
    ...MAKER_LOOK_TOOLS,
    ...MAKER_SEAM_TOOLS,
    ...WORKSPACE_SHELL_TOOLS,
    'workspace.docs',
  ]),
];

/** Every tool the Maker may be given, in the order its offer lists them. */
export const MAKER_TOOL_NAMES: readonly string[] = [
  ...new Set([...MAKER_BASE_TOOL_NAMES, ...WORKSPACE_COMPOSITION_TOOLS, ...AI_CONTEXT_TOOLS]),
];

export const makerInputSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  /** The template the timeline was cast from: what each slot is for, and its reel. */
  templateId: ulidSchema('Template').optional(),
  /** The fixes of the review before (a later round): QA's and the slot checks', in QA's fix shape. */
  fixes: z.array(qaFixSchema).max(MAX_FIXES).optional(),
  /** P3-V9: tighten a talking head first (timeline.planCleanup, then applyCleanup). */
  cleanup: z.boolean().optional(),
});
export type MakerInput = z.output<typeof makerInputSchema>;

export const makerOutputSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  revision: z.int().min(1),
  /** The last draft the step rendered (render.draft's render id), when it drafted. */
  renderId: ulidSchema('Render').optional(),
});
export type MakerOutput = z.output<typeof makerOutputSchema>;

export interface MakerSkillDeps {
  readonly service: Pick<TimelineService, 'read'>;
  /** Whether a tool is registered in this composition: the Maker lists only those (the seam's mechanism). */
  readonly registered: (tool: string) => boolean;
  /** Whether to include extended workspace composition and AI context tools when registered (default: true). */
  readonly extendedTools?: boolean;
  /**
   * match's done-gate for the handed-off timeline revision, where it is composed: passed, or why not. Absent: the
   * check reads the timeline alone.
   */
  readonly done?: (timeline: { timelineId: string; revision: number }) => AsyncResult<{
    readonly passed: boolean;
    readonly reason?: string;
  }>;
}

const retry = (reason: string): SkillVerdict => ({ verdict: 'retry', reason });

export function makerSkill(
  deps: MakerSkillDeps,
  cardId: (ctx: { flowId: string | null; runId: string }) => string,
) {
  const candidates = deps.extendedTools === false ? MAKER_BASE_TOOL_NAMES : MAKER_TOOL_NAMES;
  return defineSkill({
    id: MAKER_SKILL_ID,
    // 1.1.0 (AGT2): its description names the tools of its loop, which a small window's offer loads first
    // (agent skill-step.ts), and a shorter prompt (the 4B's first turn, agent tool-offer.ts).
    // 1.2.0: the workspace shell (workspace.open, exec, files, importMedia) where registered, and when it helps.
    version: '1.3.0',
    labelKey: 'skills.timeline.maker',
    description:
      'Makes the video from the assembled timeline in rounds: reads it with timeline.get and templates.get, edits it, ' +
      'drafts it with render.draft, compares the draft with the reel with video.compare, fixes what differs and ' +
      'finishes with video.done.',
    prompt: MAKER_PROMPT,
    tools: { names: candidates.filter((name) => deps.registered(name)) },
    input: makerInputSchema,
    output: makerOutputSchema,
    // A round is a few edits, a draft and a look; the agent sizes the turns to the model (its iteration budget).
    limits: { expectedTurns: 12, maxTurns: 24 },
    refs: (output) => [{ entity: 'timeline', id: output.timelineId, version: output.revision }],
    async verify(output) {
      const timeline = await deps.service.read(output.timelineId);
      if (!timeline.ok) return ok(retry(`Can't read the timeline: ${timeline.error.code}.`));
      if (timeline.value.revision !== output.revision)
        return ok(retry(`The timeline is at revision ${timeline.value.revision}; hand off that.`));
      const off = cutsOffAnchor(timeline.value);
      if (off.length > 0)
        return ok(
          retry(
            `${off.length} cut(s) are more than a frame off their beat (clips ${off.map((cut) => cut.clipId).join(', ')}).`,
          ),
        );
      if (!deps.done) return ok({ verdict: 'pass' });
      const done = await deps.done({ timelineId: output.timelineId, revision: output.revision });
      if (!done.ok) return ok(retry(`Can't read video.done's verdict: ${done.error.code}.`));
      return ok(
        done.value.passed
          ? { verdict: 'pass' }
          : retry(
              done.value.reason ??
                `video.done hasn't passed revision ${output.revision}: draft it, fix what it names, and call video.done.`,
            ),
      );
    },
    async card(output, ctx) {
      const timeline = await deps.service.read(output.timelineId);
      if (!timeline.ok) return timeline;
      const stats = timelineStats(timeline.value);
      return ok({
        type: 'timeline',
        id: cardId(ctx),
        version: 1,
        runId: ctx.runId,
        projectId: timeline.value.projectId,
        timelineId: timeline.value.id,
        revision: timeline.value.revision,
        duration: RationalTime.of(stats.frames, timeline.value.canvas.rate),
        clipCount: stats.clipCount,
      });
    },
  });
}
