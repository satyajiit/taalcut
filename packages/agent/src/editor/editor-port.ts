// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: what a docked run reads (SPEC section 38): the timeline the editor shows, once when the run starts (the
 * brief, logged in run.started) and once when it ends (the changes card). The composition root gives it the
 * timeline store, parsed to core's Timeline.
 */
import type { AsyncResult, EditorContext, Timeline, TimelineId } from '@taalcut/core';
import { editorBrief, type EditorBrief } from './editor-brief';

export interface EditorSources {
  timeline(timelineId: TimelineId): AsyncResult<Timeline>;
}

export interface EditorResolver {
  /** Undefined when the timeline can't be read: the run then goes on as a plain chat message. */
  brief(request: {
    readonly message: string;
    readonly context: EditorContext;
  }): Promise<EditorBrief | undefined>;
  /** The timeline as it is now. */
  timeline(timelineId: TimelineId): AsyncResult<Timeline>;
  /** Replay: the brief the run logged, whatever the store holds today. */
  readonly replay?: EditorBrief;
}

export function createEditorResolver(sources: EditorSources): EditorResolver {
  return {
    async brief({ message, context }) {
      const timeline = await sources.timeline(context.timelineId);
      return timeline.ok ? editorBrief(message, context, timeline.value) : undefined;
    },
    timeline: (timelineId) => sources.timeline(timelineId),
  };
}
