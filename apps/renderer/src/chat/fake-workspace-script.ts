// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- scripted user/model/command output for browser fixtures */

/** Reproduces the closing-shot transcript without executing a command or reading the person's files. */
import {
  newId,
  type ChatHistoryEvent,
  type ConversationId,
  type MessageId,
  type RunId,
  type ToolRunId,
} from '@taalcut/core';
import { event, settle, type Beat, type ScriptIds } from './fake-script';

export const WORKSPACE_CHAT = '01K7C5M6Q8R9S0T1V2W3X4C501' as ConversationId;
export const WORKSPACE_FAILED_CHAT = '01K7C5M6Q8R9S0T1V2W3X4C502' as ConversationId;
export const WORKSPACE_PROMPT = 'Is 100757.mp4 a good closing shot?';
export const WORKSPACE_ANSWER =
  '100757.mp4 is 17 seconds long. Its steady final frame makes a calm closing shot. Use the last few seconds to give the ending room to breathe.';

export function workspaceInspectionScript(
  ids: ScriptIds,
  text: string,
  introMessageId: MessageId = newId<'Message'>(),
): Beat[] | null {
  if (!text.includes('100757.mp4')) return null;
  const { runId, conversationId } = ids;
  const failed = /\bfail\b/i.test(text);
  const tools = [ids.toolRunId(), ids.toolRunId()];
  const beats: Beat[] = [
    { wait: 0, event: event('agent.runStarted', { runId, conversationId }) },
    {
      wait: 80,
      event: event('agent.messageDelta', {
        runId,
        messageId: introMessageId,
        delta: 'I’ll check the length and the final frame of 100757.mp4.',
      }),
    },
  ];
  tools.forEach((toolRunId, index) => {
    let startedAt = 0;
    beats.push({
      wait: 120,
      event: (at) => {
        startedAt = at;
        return event('agent.toolStarted', { runId, toolRunId, tool: 'workspace.exec', sideEffect: 'read' })(
          at,
        );
      },
    });
    const failure = failed && index === 1;
    const error = failure
      ? {
          code: 'core.timeout',
          messageKey: 'errors.core.timeout',
          retryable: true,
          fix: { command: 'agent.retryStep', labelKey: 'fix.retry', payload: { toolRunId } },
        }
      : undefined;
    const summary = failure
      ? 'workspace command timed out'
      : index === 0
        ? 'ffprobe 100757.mp4 · exit 0 · duration=17.000000'
        : 'inspect final frame · exit 0 · closing-shot-inspection.json saved';
    beats.push({
      wait: 500,
      event: (at) =>
        event('agent.toolFinished', {
          runId,
          toolRunId,
          tool: 'workspace.exec',
          status: failure ? 'failed' : 'succeeded',
          durationMs: at - startedAt,
          summary,
          ...(error ? { error } : {}),
        })(at),
    });
    beats.push({
      wait: 20,
      event: (at) =>
        event('agent.card', {
          runId,
          card: {
            type: 'toolRun',
            version: 1,
            id: toolRunId,
            runId,
            toolRunId,
            tool: 'workspace.exec',
            status: failure ? 'failed' : 'succeeded',
            startedAt,
            finishedAt: at,
            summary,
            ...(error ? { error } : {}),
            // Existing artifact metadata contract: this is a recorded result reference, not a playable clip card.
            ...(!failure && index === 1 ? { artifactIds: ['closing-shot-inspection'] } : {}),
          },
        })(at),
    });
  });
  beats.push({
    wait: 100,
    event: event('agent.messageDelta', {
      runId,
      messageId: ids.messageId,
      delta: failed
        ? '100757.mp4 is 17 seconds long. I couldn’t finish checking its final frame; retry that check before choosing the ending.'
        : WORKSPACE_ANSWER,
    }),
  });
  beats.push({
    wait: 100,
    event: event('agent.runFinished', { runId, status: failed ? 'failed' : 'succeeded' }),
  });
  return beats;
}

export function workspaceSeeds() {
  return [WORKSPACE_CHAT, WORKSPACE_FAILED_CHAT].map((conversationId, index) => {
    const id = <T>(suffix: string) => `01K7C5M6Q8R9S0T1V2W3X4${suffix}` as T;
    const at = Date.UTC(2026, 10, 6, 10, index);
    const prompt = index === 0 ? WORKSPACE_PROMPT : `${WORKSPACE_PROMPT} Let the final-frame check fail.`;
    let counter = index * 2;
    const ids: ScriptIds = {
      conversationId,
      runId: id<RunId>(`CR0${index}`),
      messageId: id<MessageId>(`CF0${index}`),
      toolRunId: () => id<ToolRunId>(`CT0${++counter}`),
    };
    const result = settle(workspaceInspectionScript(ids, prompt, id<MessageId>(`CA0${index}`))!, at + 100);
    const history: ChatHistoryEvent[] = [
      {
        type: 'user.message',
        at,
        payload: { conversationId, messageId: id<MessageId>(`CM0${index}`), text: prompt },
      },
      ...result.events,
    ];
    return {
      summary: { id: conversationId, title: '100757.mp4 closing shot', createdAt: at, updatedAt: result.end },
      history,
      hidden: true as const,
    };
  });
}
