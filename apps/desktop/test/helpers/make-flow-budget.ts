// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Only the fitted provider request is visible to the scripted stand-in. */
import { EDIT_DESIGN_ENTRY, viewOf } from '@taalcut/gate-demo';
import type { ModelRequest } from '@taalcut/models';

type Block = Exclude<Parameters<typeof viewOf>[0]['messages'][number]['content'], string>[number];
export const budgetIds = {
  projectId: '01000000000000000000000001',
  timelineId: '01000000000000000000000002',
  templateId: '01000000000000000000000003',
  renderId: '01000000000000000000000004',
};

export function fittedBody(request: ModelRequest): Parameters<typeof viewOf>[0] {
  return {
    model: 'fixture',
    system: request.system,
    tools: request.tools?.map(({ name }) => ({ name })),
    messages: request.messages.map((message) =>
      message.role === 'assistant'
        ? {
            role: 'assistant',
            content: message.parts.flatMap<Block>((part) =>
              part.type === 'tool_call'
                ? [{ type: 'tool_use', id: part.call.id, name: part.call.name, input: part.call.arguments }]
                : part.type === 'text'
                  ? [{ type: 'text', text: part.text }]
                  : [],
            ),
          }
        : message.role === 'tool'
          ? {
              role: 'user',
              content: [
                { type: 'tool_result', tool_use_id: message.toolCallId, content: String(message.content) },
              ],
            }
          : { role: 'user', content: String(message.content) },
    ),
  };
}

export const fittedView = (request: ModelRequest) => viewOf(fittedBody(request));

/** Numeric ULIDs stress the estimator; unused descriptions must not displace exact decision fields. */
export function makeFlowBudgetFixture() {
  const timeline = {
    id: budgetIds.timelineId,
    projectId: budgetIds.projectId,
    name: 'Courtyard reel',
    revision: 3,
    rate: { num: 30, den: 1 },
    frames: 780,
    clips: Array.from({ length: 13 }, (_, index) => ({
      clip: index + 1,
      clipId: `010000000000000000000000${String(index + 10).padStart(2, '0')}`,
      slotId: `010000000000000000000000${String(index + 30).padStart(2, '0')}`,
      kind: 'clip',
      locked: index === 0,
      userPick: index === 0,
      at: index * 2,
      seconds: 2,
      shows: 'The creator crosses the courtyard with the selected footage and original timing. '.repeat(4),
    })),
    texts: [
      {
        itemId: '01000000000000000000000090',
        text: 'My own courtyard words',
        origin: 'user',
        start: 0,
        frames: 60,
      },
    ],
    markers: Array.from({ length: 13 }, (_, index) => ({
      markerId: `010000000000000000000000${String(index + 50).padStart(2, '0')}`,
      kind: 'beat',
      label: 'Reference beat and cut',
      at: index * 2,
      seconds: 0,
    })),
  };
  const draft = {
    render: {
      id: budgetIds.renderId,
      projectId: budgetIds.projectId,
      timelineId: budgetIds.timelineId,
      timelineRevision: 3,
      presetId: 'device',
      status: 'ready',
      jobId: null,
      progress: null,
      name: 'Courtyard reel',
      durationFrames: 780,
      rate: { num: 30, den: 1 },
      bytes: 7_473_280,
      music: 'referenceAudio',
      captions: { burnIn: true, sidecars: [] },
      qa: {
        verdict: 'passedWithWarnings',
        round: 1,
        passed: 20,
        warned: 1,
        failed: 0,
        fixed: 0,
        failing: [],
      },
      supersedes: null,
      notify: false,
      errorCode: null,
      createdAt: 1_794_490_093_422,
      finishedAt: 1_794_490_118_796,
    },
    failing: [],
    report: {
      id: '01000000000000000000000070',
      mediaType: 'application/json',
      bytes: 12_000,
      summary: 'QA measurements 0123456789 remain in the full report. '.repeat(400),
    },
    timelineRevision: 3,
    passed: true,
    slotMatch: [],
  };
  const done = { renderId: budgetIds.renderId, revision: 3, slots: 13, waived: [], compared: true };
  const comments = {
    timelineId: budgetIds.timelineId,
    revision: 3,
    rate: { num: 30, den: 1 },
    comments: Array.from({ length: 3 }, (_, index) => ({
      commentId: `010000000000000000000000${index + 80}`,
      status: 'sent',
      on: 'clip',
      itemId: timeline.clips[index]!.clipId,
      start: index * 60,
      end: (index + 1) * 60,
      body:
        `Comment ${index + 1}: please keep this selected view. ` +
        'Preserve the timing of this courtyard shot. '.repeat(20),
    })),
  };
  const design = {
    'workspace.write': { path: EDIT_DESIGN_ENTRY, revision: 1, bytes: 2500 },
    'workspace.lint': {
      entry: EDIT_DESIGN_ENTRY,
      passed: true,
      checks: [],
      findings: [],
      variables: [],
      tweens: 3,
    },
    'graphics.list': { revision: 3, items: [] },
    'workspace.place': {
      projectId: budgetIds.projectId,
      timelineId: budgetIds.timelineId,
      itemIds: ['01000000000000000000000091'],
      revision: 4,
      compositionId: '01000000000000000000000092',
      version: 1,
      name: 'Newspaper headline',
      start: { value: 120, rate: { num: 30, den: 1 } },
      duration: { value: 105, rate: { num: 30, den: 1 } },
      unmatched: [],
      note: 'The design is a proposal until the creator chooses Use it. '.repeat(100),
    },
  };
  return { timeline, draft, done, comments, design };
}
