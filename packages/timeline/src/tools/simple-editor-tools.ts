// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  defineTool,
  err,
  NO_TOOL_RETRY,
  NotImplementedError,
  ok,
  SIMPLE_EDITOR_COMMANDS as N,
  simpleEditorPayloads as P,
  simpleEditorResultSchema,
  timelineTranscriptSchema,
  ulidSchema,
  type AnyTool,
} from '@taalcut/core';
import { z } from 'zod';
import type { TimelineService } from '../service/service';
import { editCommandTool } from './edit-command-tool';
import { toolKey } from './hash';

/** Domain-owned descriptions: every persistent operation dispatches the UI's exact command. */
const descriptions = {
  [N.removeWords]:
    'Removes selected spoken words and their footage, including linked audio, captions and graphics, in one undo step. Get occurrence references from timeline.transcript; identify each duplicate by clipId. A locked or stale selection changes nothing.',
  [N.replaceCaptions]:
    'Finds literal text in displayed captions and replaces it in one or all matching cues. Only displayed words change; recorded speech and footage are untouched. cueIds limits replacement to inspected cues; omission replaces all matches.',
  [N.adjustClips]:
    'Adjusts Color, Sound or Framing on all selected clips in one undo step. Every selected clip must support every adjustment and be unlocked; otherwise nothing changes.',
  [N.copyClipSettings]:
    'Copies the chosen Color, Sound and Framing settings from one clip to all selected clips, in one undo step. The complete selection is validated first.',
  [N.addNarration]:
    'Places an already saved audio take at a timeline position in one undo step. It never starts or accesses the microphone. Ask the person to use Sound → Record voice to make a new take.',
  [N.makeSize]:
    'Creates an independent editable video copy in 9:16, 4:5, 1:1 or 16:9 at 1080-class dimensions. Preserves the original, timing, frame rate, audio and normalized graphic placement. The returned timelineId is the new copy.',
  [N.freezeFrame]:
    'Inserts a two-second hold of the exact selected video frame, or a supplied duration, in one undo step. The frame retains editable color and framing; source sound is muted and later content follows the existing insertion rules.',
  [N.setHoldDuration]:
    'Changes the duration of a held frame, moving following content by the difference, in one undo step.',
} as const;

/** Search summaries describe the action, without repeating incidental constraints from its documentation. */
const summaries = {
  [N.removeWords]: 'Cuts spoken transcript words from the recording and closes the gap.',
  [N.replaceCaptions]: 'Finds and replaces literal caption text in one or all matching cues.',
  [N.adjustClips]: 'Applies shared color, sound or framing adjustments to multiple selected scenes.',
  [N.copyClipSettings]: 'Copies chosen color, sound and framing settings between scenes.',
  [N.addNarration]: 'Places a saved narration take at a chosen time.',
  [N.makeSize]: 'Creates a separate resized video in a chosen aspect ratio.',
  [N.freezeFrame]: 'Freezes the selected moment with an editable hold frame.',
  [N.setHoldDuration]: 'Lengthens or shortens an existing freeze frame.',
} as const;

export function simpleEditorTools(service: TimelineService): AnyTool[] {
  const transcript = defineTool({
    name: 'timeline.transcript',
    version: '1.0.0',
    description:
      'Reads spoken words with source timing, timeline intervals and clip occurrence references. Duplicated footage appears separately. Use these references and the returned revision with timeline.removeWords.',
    summary: 'Reads the spoken words of a video for word-based editing.',
    tags: ['transcript', 'words', 'speech', 'read'],
    input: z.object({ timelineId: ulidSchema('Timeline') }),
    output: timelineTranscriptSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 30_000,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (input) => toolKey('timeline.transcript', input),
    run: (input) =>
      service.transcript
        ? service.transcript(input.timelineId)
        : Promise.resolve(err(NotImplementedError({ feature: 'timelines.transcript' }))),
  });
  const mutations = Object.values(N).map((command) =>
    editCommandTool({
      command,
      description: descriptions[command],
      summary: summaries[command],
      tags: command
        .replace('timeline.', '')
        .split(/(?=[A-Z])/)
        .map((part) => part.toLowerCase()),
      input:
        command === N.addNarration
          ? z.object({
              projectId: ulidSchema('Project'),
              timelineId: ulidSchema('Timeline'),
              revision: z.int().positive(),
              assetId: ulidSchema('Asset'),
              at: P[N.freezeFrame].shape.at,
            })
          : (P[command] as z.ZodType),
      output: simpleEditorResultSchema,
      verify: async (result) => {
        const receipt = simpleEditorResultSchema.parse(result);
        const committed = await service.read(receipt.timelineId);
        if (!committed.ok) return committed;
        return committed.value.revision === receipt.revision
          ? ok(undefined)
          : err(ConflictError({ entity: 'timeline', id: receipt.timelineId }));
      },
    }),
  );
  return [transcript as AnyTool, ...mutations];
}
