// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: what a docked run reads (SPEC section 38): the timeline the editor shows, once when the run starts (the
 * brief, logged in run.started) and once when it ends (the changes card). The composition root gives it the
 * timeline store, parsed to core's Timeline.
 */
import type {
  AsyncResult,
  CoverRequest,
  EditorContext,
  PostCaptionRequest,
  Timeline,
  TimelineId,
} from '@taalcut/core';
import { editorBrief, type EditorBrief } from './editor-brief';
import { withPostCaption } from './post-caption-brief';

export interface EditorSources {
  timeline(timelineId: TimelineId): AsyncResult<Timeline>;
}

export interface EditorResolver {
  /** Undefined when the timeline can't be read: the run then goes on as a plain chat message. */
  brief(request: {
    readonly message: string;
    readonly context: EditorContext;
    /** CVR1: the cover the message asks for, when it came from the cover panel. */
    readonly cover?: CoverRequest | undefined;
    /** CAP1: the post caption the message asks for, when it came from the caption panel. */
    readonly postCaption?: PostCaptionRequest | undefined;
  }): Promise<EditorBrief | undefined>;
  /** The timeline as it is now. */
  timeline(timelineId: TimelineId): AsyncResult<Timeline>;
  /** Replay: the brief the run logged, whatever the store holds today. */
  readonly replay?: EditorBrief;
}

export function createEditorResolver(sources: EditorSources): EditorResolver {
  return {
    async brief({ message, context, cover, postCaption }) {
      const timeline = await sources.timeline(context.timelineId);
      // CAP1: a caption asked for in the caption panel joins the brief (post-caption-brief.ts).
      return timeline.ok
        ? withPostCaption(editorBrief(message, context, timeline.value, cover), postCaption)
        : undefined;
    },
    timeline: (timelineId) => sources.timeline(timelineId),
  };
}
