// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- scripted model and tool output for browser fixtures */

/** A recorded-style inspection stream; no media, tools or model requests execute. */
import { newId } from '@taalcut/core';
import { event, stream, type Beat, type ScriptIds } from './fake-script';

export const FRAME_INSPECTION_PROMPT = 'Check the nine airport frames';
export const FRAME_INSPECTION_INTRO =
  'I’ll sample the airport sequence, then compare the lighting and framing across the cut.';
export const FRAME_INSPECTION_UPDATE =
  'The samples are ready. I’m checking the opening, middle, and closing frames for lighting changes.';
export const FRAME_INSPECTION_ANSWER =
  'The opening and middle frames have consistent lighting. The closing shot has a pink reflection in the dark sky. Keep its framing and timing, and clean up that reflection before export.';

const CAPTURE_TIMES = [4_200, 4_100, 0, 3_200, 1_000, 1_000, 900, 5_600, 1_300];
const FRAME_CHECKS = [
  'Opening frame: balanced exposure and clear framing.',
  'Middle frame: warm highlights consistent with the opening.',
  'Closing frame: pink reflection in the dark sky.',
];

function captureFrames(ids: ScriptIds): Beat[] {
  return CAPTURE_TIMES.flatMap((durationMs, index): Beat[] => {
    const toolRunId = ids.toolRunId();
    return [
      {
        wait: 40,
        event: event('agent.toolStarted', {
          runId: ids.runId,
          toolRunId,
          tool: 'timeline.captureFrame',
          sideEffect: 'read',
        }),
      },
      {
        wait: durationMs,
        event: event('agent.toolFinished', {
          runId: ids.runId,
          toolRunId,
          tool: 'timeline.captureFrame',
          status: 'succeeded',
          durationMs,
          summary: `Airport sequence · frame ${index + 1}`,
        }),
      },
    ];
  });
}

function inspectFrames(ids: ScriptIds): Beat[] {
  const calls = FRAME_CHECKS.map((summary) => ({ toolRunId: ids.toolRunId(), summary }));
  return [
    ...calls.map(({ toolRunId }): Beat => ({
      wait: 80,
      event: event('agent.toolStarted', {
        runId: ids.runId,
        toolRunId,
        tool: 'vision.describeFrame',
        sideEffect: 'read',
      }),
    })),
    ...calls.map(({ toolRunId, summary }, index): Beat => ({
      wait: index === 0 ? 1_600 : 100,
      event: event('agent.toolFinished', {
        runId: ids.runId,
        toolRunId,
        tool: 'vision.describeFrame',
        status: 'succeeded',
        durationMs: 1_760 + index * 20,
        summary,
      }),
    })),
  ];
}

/** Stable event order and text; the caller supplies fresh run/tool ids like the real chat. */
export function frameInspectionScript(ids: ScriptIds, text: string): Beat[] | null {
  if (text.trim().toLowerCase() !== FRAME_INSPECTION_PROMPT.toLowerCase()) return null;
  const { runId, conversationId } = ids;
  return [
    { wait: 0, event: event('agent.runStarted', { runId, conversationId }) },
    ...stream({ ...ids, messageId: newId<'Message'>() }, FRAME_INSPECTION_INTRO, 'agent.messageDelta', 28),
    ...stream(
      ids,
      'I’m comparing the opening, middle, and closing frames to check continuity.',
      'agent.reasoningDelta',
      35,
    ),
    {
      wait: 80,
      event: event('agent.plan', {
        runId,
        steps: [
          { id: 'capture', text: 'Sample the airport sequence', status: 'running' },
          { id: 'inspect', text: 'Compare lighting and framing', status: 'pending' },
          { id: 'conclude', text: 'Summarize the edit', status: 'pending' },
        ],
      }),
    },
    ...captureFrames(ids),
    { wait: 20, event: event('agent.step', { runId, stepId: 'capture', status: 'done' }) },
    ...stream({ ...ids, messageId: newId<'Message'>() }, FRAME_INSPECTION_UPDATE, 'agent.messageDelta', 28),
    { wait: 20, event: event('agent.step', { runId, stepId: 'inspect', status: 'running' }) },
    ...inspectFrames(ids),
    { wait: 20, event: event('agent.step', { runId, stepId: 'inspect', status: 'done' }) },
    { wait: 20, event: event('agent.step', { runId, stepId: 'conclude', status: 'running' }) },
    ...stream(
      ids,
      ' The closing frame needs a reflection cleanup; the framing and timing can stay.',
      'agent.reasoningDelta',
      35,
    ),
    ...stream(ids, FRAME_INSPECTION_ANSWER, 'agent.messageDelta', 32),
    { wait: 20, event: event('agent.step', { runId, stepId: 'conclude', status: 'done' }) },
    { wait: 80, event: event('agent.runFinished', { runId, status: 'succeeded' }) },
  ];
}
