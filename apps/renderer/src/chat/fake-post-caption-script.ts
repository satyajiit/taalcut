// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- scripted model output: data, never translated */

/**
 * CAP1: the fake agent's answer to a caption asked for in the editor's caption panel ("Generate with AI"), as
 * the real Editor acts: it reads the video, reads the guide, then saves the caption's parts with
 * `timeline.setPostCaption` (the fake's tool builds the text by core's rule and keeps it on the timeline, so
 * the panel fills in), and says in one line that it is saved. The request is data on the message
 * (`postCaption`), so the script runs whatever the words are. Its copy is made up from the video's name: nothing
 * is written by a model here. Reads the fake's timelines and bus through `window.taalcutFake`.
 */
import {
  POST_CAPTION_COMMAND,
  postCaptionRule,
  type EditorContext,
  type PostCaptionParts,
  type PostCaptionRequest,
  type Timeline,
} from '@taalcut/core';
import { chunks, event, type Beat, type ScriptIds } from './fake-script';

function say(ids: ScriptIds, text: string): Beat[] {
  return chunks(text).map((delta) => ({
    wait: 40,
    event: event('agent.messageDelta', { runId: ids.runId, messageId: ids.messageId, delta }),
  }));
}

/** A tool's start and finish, around what it does in the fake. */
function tool(ids: ScriptIds, name: string, sideEffect: 'read' | 'write', act?: () => void): Beat[] {
  const toolRunId = ids.toolRunId();
  const { runId } = ids;
  let startedAt = 0;
  return [
    {
      wait: 80,
      event: (at) => {
        startedAt = at;
        act?.();
        return event('agent.toolStarted', { runId, toolRunId, tool: name, sideEffect })(at);
      },
    },
    {
      wait: 200,
      event: (at) =>
        event('agent.toolFinished', {
          runId,
          toolRunId,
          tool: name,
          status: 'succeeded',
          durationMs: Math.max(0, at - startedAt),
        })(at),
    },
  ];
}

/** The parts the fake "writes" for a video: its name, and words made from the name. Asked again, another opening. */
export function fakePostCaptionParts(
  timeline: Pick<Timeline, 'name' | 'tracks' | 'postCaptions'>,
): PostCaptionParts {
  const words = timeline.name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const plain = words.join(' ') || 'This video';
  const tags = [
    ...new Set(words.filter((word) => /\p{L}{3,}/u.test(word)).map((word) => word.toLowerCase())),
  ];
  const shots = timeline.tracks
    .filter((track) => track.kind === 'video')
    .reduce((count, track) => count + track.items.filter((item) => item.type === 'clip').length, 0);
  const hooks = [
    `${plain}: ${shots} shots, and the last one is the reason we stayed.`,
    `We almost skipped the last stop. ${plain}, in ${shots} shots.`,
  ];
  const kept = timeline.postCaptions?.map((caption) => caption.text).join('\n') ?? '';
  return {
    body: [
      hooks.find((hook) => !kept.includes(hook)) ?? hooks[0]!,
      'Everything here was filmed on the day, in the order it happened. Nothing staged, nothing added later. ' +
        'Which moment would you go back for?',
    ].join('\n\n'),
    hashtags: tags.length > 0 ? tags.slice(0, 3) : ['video'],
    keywords: [plain.toLowerCase(), `${plain.toLowerCase()} video`, `${plain.toLowerCase()} in one day`],
  };
}

/** The fake Editor's run for a caption asked for in the caption panel; null for a message that asks for none. */
export function postCaptionScript(
  ids: ScriptIds,
  request: PostCaptionRequest | undefined,
  editor: EditorContext | undefined,
): Beat[] | null {
  if (!request || !editor) return null;
  const { runId, conversationId } = ids;
  const start: Beat = { wait: 0, event: event('agent.runStarted', { runId, conversationId }) };
  const end: Beat = { wait: 100, event: event('agent.runFinished', { runId, status: 'succeeded' }) };
  const fake = window.taalcutFake;
  const timeline = fake?.make.timelines.get(editor.timelineId);
  if (!fake || !timeline)
    return [start, ...say(ids, 'I can’t find this video any more, so there is no caption to write.'), end];
  const { name } = postCaptionRule(request.platform);
  const target = { projectId: timeline.projectId, timelineId: timeline.id };
  const save = () =>
    void fake.make.postCaption.write(
      fake.bus,
      target,
      request.platform,
      fakePostCaptionParts(fake.make.timelines.get(timeline.id) ?? timeline),
      `agent:${runId}`,
    );
  return [
    start,
    ...tool(ids, 'timeline.get', 'read'),
    ...tool(ids, 'workspace.docs', 'read'),
    ...tool(ids, POST_CAPTION_COMMAND, 'write', save),
    ...say(
      ids,
      request.note
        ? `Your ${name} caption is saved with the video, written around your note: “${request.note}”.`
        : `Your ${name} caption is saved with the video. It’s in the caption panel, ready to copy.`,
    ),
    end,
  ];
}
