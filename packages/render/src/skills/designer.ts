// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Designer (HFW1 "dsn", render SPEC "HFW1: the Designer"): every graphic a video needs, designed by the model
 * as a HyperFrames composition in the project's workspace, checked by Taalcut's gate, looked at over the footage,
 * and put on the timeline as a proposal the person can use, try again, undo or ask to change. It runs after the
 * Editor's step when the Editor recorded design jobs (`graphics.design`; the agent's flow-followups add the step),
 * and for template reading and a make (tpl). Modelled on the Reviewer: a deterministic check before the handoff,
 * here that every job ended placed or with a stated reason. Whatever model the chain gives it designs: a vision
 * model sees its stills, a text-only one reads the frame checks; nothing falls back to a ready-made design.
 */
import { defineSkill, ok, type Timeline, type TimelineId } from '@taalcut/core';
import type { TimelineAccess } from '../ports';
import { WORKSPACE_EXTRA_TOOLS, WORKSPACE_TOOLS } from '../workspace/tools/module';
import {
  checkDesigns,
  designerInputSchema,
  designerOutputSchema,
  type DesignerInput,
} from './designer-checks';
import { DESIGNER_PROMPT } from './designer-prompt';

export const DESIGNER_SKILL_ID = 'render.designer';
export const DESIGNER_LABEL = 'skills.render.designer';

/** The tools besides the workspace's: what is on the timeline, a frame of it, and the comment a job answers. */
export const DESIGNER_TOOLS = [
  ...WORKSPACE_TOOLS,
  'graphics.list',
  'graphics.edit',
  'graphics.remove',
  'timeline.get',
  'timeline.captureFrame',
  'comments.reply',
] as const;

/**
 * Additional sandbox shell, library, vision, template, timeline and memory tools the Designer may use when the
 * composition registers them: full-video HyperFrames authoring (`workspace.open`/`exec`/`files`/`importMedia` +
 * `timeline.insertClip`/`swapClip`), frame inspection, asset lookup, still generation and creator preferences.
 */
export const DESIGNER_EXTRA_TOOLS = [
  ...WORKSPACE_EXTRA_TOOLS,
  'workspace.open',
  'workspace.exec',
  'workspace.files',
  'workspace.importMedia',
  'templates.get',
  'templates.styleProfile',
  'vision.describeFrame',
  'vision.matchLook',
  'video.compare',
  'library.search',
  'library.findSimilar',
  'library.getAsset',
  'library.frameAt',
  'library.subjects',
  'image.generate',
  'images.generateForSlot',
  'images.generateThumbnail',
  'captions.translate',
  'memory.recall',
  'memory.remember',
  'comments.list',
  'timeline.insertClip',
  'timeline.swapClip',
] as const;

export interface DesignerSkillDeps {
  readonly timelines: Pick<TimelineAccess, 'get'>;
  /** Whether an optional tool is registered in the composition. Absent: only `DESIGNER_TOOLS` are listed. */
  readonly registered?: (tool: string) => boolean;
}

export function designerSkill(deps: DesignerSkillDeps) {
  const extras = DESIGNER_EXTRA_TOOLS.filter((name) => deps.registered?.(name) ?? false);
  return defineSkill({
    id: DESIGNER_SKILL_ID,
    version: '1.0.0',
    labelKey: DESIGNER_LABEL,
    description:
      "Designs the video's graphics as HyperFrames compositions in the project's workspace, checks and looks at " +
      'them over the footage, and proposes them on the timeline.',
    prompt: DESIGNER_PROMPT,
    tools: { names: [...new Set([...DESIGNER_TOOLS, ...extras])] },
    input: designerInputSchema,
    output: designerOutputSchema,
    refs: (output) => [{ entity: 'timeline', id: output.timelineId, version: output.revision }],
    async verify(output, ctx) {
      const timeline = await deps.timelines.get(output.timelineId as TimelineId);
      if (!timeline.ok)
        return ok({
          verdict: 'retry',
          reason: `Can't read the timeline (${timeline.error.code}): hand off its id.`,
        });
      const input = ctx.input as DesignerInput | undefined;
      if (input && input.timelineId !== output.timelineId)
        return ok({ verdict: 'retry', reason: `Hand off the job's timeline, ${input.timelineId}.` });
      return ok(checkDesigns(output, input, timeline.value as Timeline));
    },
    // A job is read, written, linted, rendered a few times and placed.
    limits: { expectedTurns: 10, maxTurns: 30 },
  });
}
