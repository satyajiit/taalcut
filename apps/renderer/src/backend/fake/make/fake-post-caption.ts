// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: post captions as the fake serves them. `timeline.setPostCaption` keeps the text on the fake's timeline
 * document as the real command does (any text from a person, one undo step, nothing else in the video moves);
 * `settings.setPostCaptionCredit` and `postCaption.credit` are core's own, over a settings store in memory.
 * `write` is the fake agent's tool: it builds the text from parts by core's rule, with the credit as the switch
 * says, and saves it as the AI's.
 */
import {
  buildPostCaption,
  createMemorySettingsStore,
  createPostCaptionCreditCommands,
  defineCommand,
  err,
  ok,
  POST_CAPTION_COMMAND,
  POST_CAPTION_CREDIT_SETTING,
  postCaptionRouter,
  setPostCaptionPayloadSchema,
  type AnyCommand,
  type CommandBus,
  type PostCaptionIssue,
  type PostCaptionParts,
  type PostCaptionPlatform,
  type SavedPostCaption,
  type Timeline,
} from '@taalcut/core';
import { timelineError } from './edits';
import type { FakeTimelines } from './fake-timelines';

export function createFakePostCaption(timelines: FakeTimelines) {
  const settings = createMemorySettingsStore();
  const setCaption = defineCommand({
    name: POST_CAPTION_COMMAND,
    payload: setPostCaptionPayloadSchema,
    sideEffect: 'write',
    project: (p) => p.projectId,
    handle: (p, context) => {
      const before = timelines.get(p.timelineId);
      if (!before) return err(timelineError('timeline.not_found', { timelineId: p.timelineId }));
      const held = before.postCaptions ?? [];
      const was = held.find((caption) => caption.platform === p.platform);
      const writtenBy = p.writtenBy ?? (context.source === 'agent' ? 'ai' : 'person');
      const answer = (revision: number) => ({
        timelineId: before.id,
        revision,
        affectedItemIds: [],
        platform: p.platform,
        text: p.text,
      });
      const same = p.text === null ? !was : was?.text === p.text && was.writtenBy === writtenBy;
      if (same) return ok({ result: answer(before.revision) });
      const others = held.filter((caption) => caption.platform !== p.platform);
      const next: SavedPostCaption[] =
        p.text === null ? others : [...others, { platform: p.platform, text: p.text, writtenBy }];
      const { postCaptions: _held, ...rest } = before;
      const edited: Timeline = next.length > 0 ? { ...rest, postCaptions: next } : rest;
      const written = timelines.write(
        p.projectId,
        before,
        { ok: true, timeline: edited },
        {
          name: POST_CAPTION_COMMAND,
          payload: {
            projectId: p.projectId,
            timelineId: before.id,
            platform: p.platform,
            text: was?.text ?? null,
            ...(was ? { writtenBy: was.writtenBy } : {}),
          },
        },
      );
      if (!written.ok) return written;
      return ok({ ...written.value, result: answer(written.value.result.revision) });
    },
  });
  const commands: AnyCommand[] = [setCaption, ...createPostCaptionCreditCommands(settings).all];

  return {
    router: { postCaption: postCaptionRouter(settings) },
    commands,
    /**
     * The fake agent's `timeline.setPostCaption`: the parts built by the rule and saved, or what the rule
     * refused (nothing is saved then).
     */
    async write(
      bus: CommandBus,
      target: { readonly projectId: Timeline['projectId']; readonly timelineId: Timeline['id'] },
      platform: PostCaptionPlatform,
      parts: PostCaptionParts,
      actor: string,
    ): Promise<readonly PostCaptionIssue[]> {
      const credit = await settings.get(POST_CAPTION_CREDIT_SETTING);
      const built = buildPostCaption(platform, parts, { credit: credit.ok ? credit.value : true });
      if (built.issues.length > 0) return built.issues;
      await bus.dispatch(
        POST_CAPTION_COMMAND,
        { ...target, platform, text: built.text, writtenBy: 'ai' },
        { source: 'agent', actor },
      );
      return [];
    },
  };
}

export type FakePostCaption = ReturnType<typeof createFakePostCaption>;
