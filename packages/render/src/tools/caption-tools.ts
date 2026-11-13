// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's caption tools: each wraps its command (createCaptionCommands),
 * so an agent edit is the same undoable, audited step as the editor's.
 * Cue text is the user's words, so it comes back marked untrusted.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  CAPTION_COMMANDS,
  captionStyleSchema,
  defineTool,
  defineToolModule,
  NO_TOOL_RETRY,
  ok,
  type ToolModule,
  type TimelineId,
  ulidSchema,
} from '@taalcut/core';
import { captionSummarySchema } from './schemas';
import type { TimelineAccess } from '../ports';

const payloadKey = (name: string, payload: unknown) =>
  createHash('sha256')
    .update(JSON.stringify([name, payload]))
    .digest('hex');

const target = {
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive().optional(),
};

/** One caption tool over its command; the command returns the track summary. */
function captionTool<I extends z.ZodObject>(spec: {
  readonly timelines?: TimelineAccess | undefined;
  readonly name: string;
  readonly command: string;
  readonly description: string;
  readonly summary?: string;
  readonly tags: readonly string[];
  readonly input: I;
}) {
  return defineTool({
    name: spec.name,
    version: '1.0.0',
    description: spec.description,
    ...(spec.summary ? { summary: spec.summary } : {}),
    tags: spec.tags,
    input: spec.input,
    output: captionSummarySchema,
    costClass: 'local',
    sideEffect: 'write',
    command: spec.command,
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    idempotencyKey: (input) => payloadKey(spec.name, input),
    run: async (input, ctx) => {
      let payload = input;
      if (spec.timelines) {
        const target = input as { timelineId: TimelineId; revision?: number };
        const current = await spec.timelines.get(target.timelineId);
        if (!current.ok) return current;
        payload = { ...input, revision: target.revision ?? current.value.revision };
      }
      const done = await ctx.dispatch(payload);
      return done.ok ? ok(captionSummarySchema.parse(done.value)) : done;
    },
  });
}

export function captionToolModule(timelines?: TimelineAccess): ToolModule {
  const setEnabled = captionTool({
    timelines,
    name: CAPTION_COMMANDS.setEnabled,
    command: CAPTION_COMMANDS.setEnabled,
    description:
      'Turns burnt-in captions on or off for a timeline. Turning them on when it has no cues builds them from ' +
      'the transcript, in the reference look or the default style. Undoable.',
    tags: ['captions', 'subtitles', 'toggle'],
    input: z.object({ ...target, enabled: z.boolean() }),
  });
  const editText = captionTool({
    timelines,
    name: CAPTION_COMMANDS.editText,
    command: CAPTION_COMMANDS.editText,
    description:
      'Corrects one caption cue: fix spelling, replace a misheard word, or shorten a line. For "the caption ' +
      'should say …", pass the complete corrected text for that cue. Recorded speech stays unchanged. ' +
      'Word timings are shared out over the cue; empty text deletes the cue. Undoable.',
    summary: 'Corrects the words a caption says, including spelling and misheard speech.',
    tags: ['captions', 'caption', 'text', 'typo', 'edit', 'words', 'say', 'says', 'wrong', 'misheard', 'fix'],
    input: z.object({ ...target, cueId: ulidSchema('CaptionCue'), text: z.string().max(500) }),
  });
  const setStyle = captionTool({
    timelines,
    name: CAPTION_COMMANDS.setStyle,
    command: CAPTION_COMMANDS.setStyle,
    description:
      'Changes the caption style: font, weight, size, colours, outline, background box, highlight, case, ' +
      'vertical position (anchorY, 0 top to 1 bottom), lines and words per cue. Only the fields given change. ' +
      'Undoable.',
    summary: 'Changes the caption style; only the fields given change.',
    tags: ['captions', 'style', 'font', 'position', 'safe-zone'],
    input: z.object({ ...target, style: captionStyleSchema.omit({ version: true }).partial() }),
  });
  const rebuild = captionTool({
    timelines,
    name: CAPTION_COMMANDS.rebuild,
    command: CAPTION_COMMANDS.rebuild,
    description:
      'Regroups the caption cues from the transcript after cuts or a style change. Cues the user edited stay. ' +
      'Undoable.',
    tags: ['captions', 'transcript', 'regroup'],
    input: z.object(target),
  });
  return defineToolModule({ id: 'captions', tools: [setEnabled, editText, setStyle, rebuild] });
}
