// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: `timeline.setPostCaption`, the text to paste under the post for one platform, kept on the video's
 * timeline document (`postCaptions`, one per platform). It writes that one field: no clip, text, graphic or
 * subtitle moves. One undo step, its own inverse (the caption as it was, or none). The command keeps any text: a
 * person's own edit is never refused. The platform's rule is held where the AI writes, in the tool
 * (tools/post-caption-tool.ts), which builds the text it sends here.
 */
import {
  ConflictError,
  defineCommand,
  err,
  ok,
  POST_CAPTION_COMMAND,
  setPostCaptionPayloadSchema,
  type SavedPostCaption,
  type Timeline,
} from '@taalcut/core';
import { commit, readFor, type CommandDeps } from './context';

export function postCaptionCommand(deps: CommandDeps) {
  return defineCommand({
    name: POST_CAPTION_COMMAND,
    payload: setPostCaptionPayloadSchema,
    sideEffect: 'write',
    handle: async (payload, context) => {
      const { projectId, timelineId, platform, text } = payload;
      const current = await readFor(deps.store, timelineId, projectId);
      if (!current.ok) return current;
      if (
        payload.revision !== undefined &&
        context.replay !== 'redo' &&
        payload.revision !== current.value.revision
      )
        return err(ConflictError({ entity: 'timeline', id: timelineId }));
      const held = current.value.postCaptions ?? [];
      const before = held.find((caption) => caption.platform === platform);
      // The agent's caption is the AI's; anyone else's is the person's, unless the inverse says whose it was.
      const writtenBy = payload.writtenBy ?? (context.source === 'agent' ? 'ai' : 'person');
      const same =
        text === null ? before === undefined : before?.text === text && before.writtenBy === writtenBy;
      if (same)
        return ok({
          result: { timelineId, revision: current.value.revision, affectedItemIds: [], platform, text },
        });
      const others = held.filter((caption) => caption.platform !== platform);
      const next: SavedPostCaption[] = text === null ? others : [...others, { platform, text, writtenBy }];
      const { postCaptions: _held, ...rest } = current.value;
      const edited: Timeline = next.length > 0 ? { ...rest, postCaptions: next } : rest;
      const written = await commit(deps, current.value, edited, context);
      if (!written.ok) return written;
      return ok({
        result: {
          timelineId: written.value.id,
          revision: written.value.revision,
          // A caption is no item of the video: nothing on the timeline was touched.
          affectedItemIds: [],
          platform,
          text,
        },
        inverse: {
          name: POST_CAPTION_COMMAND,
          payload: {
            projectId,
            timelineId,
            platform,
            text: before?.text ?? null,
            ...(before ? { writtenBy: before.writtenBy } : {}),
          },
        },
      });
    },
  });
}
