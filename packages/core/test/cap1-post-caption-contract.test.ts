// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: a post caption asked for in the editor's caption panel travels on the message as data, with its
 * platform; the saved caption is part of the timeline document; the credit line is a setting only a person
 * changes.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  chatContract,
  connectRpc,
  createCommandBus,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  createPostCaptionCreditCommands,
  MAX_POST_CAPTIONS,
  messageExtrasShape,
  newId,
  POST_CAPTION_CREDIT_SETTING,
  POST_CAPTION_NOTE_MAX,
  POST_CAPTION_PLATFORMS,
  POST_CAPTION_SETTING_COMMANDS,
  POST_CAPTION_TEXT_MAX,
  postCaptionContract,
  postCaptionRequestSchema,
  postCaptionRouter,
  savedPostCaptionSchema,
  serveRpc,
  setPostCaptionPayloadSchema,
  systemClock,
  timelineSchema,
  userMessageEventSchema,
} from '@taalcut/core';
import { at, json, ntscTimeline, T0 } from './helpers/documents';
import { channel } from './helpers/ports';

describe('a post caption request (CAP1)', () => {
  it('names a platform of the rule table and keeps the note to one trimmed line', () => {
    for (const platform of POST_CAPTION_PLATFORMS)
      expect(postCaptionRequestSchema.parse({ platform })).toEqual({ platform });
    expect(
      postCaptionRequestSchema.parse({ platform: 'instagram', note: '  Mention the egg coffee  ' }),
    ).toEqual({ platform: 'instagram', note: 'Mention the egg coffee' });
    for (const invalid of [
      {},
      { platform: 'myspace' },
      { platform: 'instagram', note: '' },
      { platform: 'instagram', note: '   ' },
      { platform: 'instagram', note: 'x'.repeat(POST_CAPTION_NOTE_MAX + 1) },
      { note: 'A caption' },
    ])
      expect(postCaptionRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('goes with a sent message and stays on the stored one; a message without it reads as before', () => {
    const conversationId = newId<'Conversation'>();
    const postCaption = { platform: 'instagram', note: 'Mention the egg coffee' };
    const editorContext = { timelineId: newId<'Timeline'>(), revision: 2, playhead: at(0), selection: [] };
    const input = { conversationId, text: 'Write an Instagram caption.', editorContext, postCaption };
    const send = chatContract.send['~orpc'].inputSchema!;
    expect(send.safeParse(json(input))).toMatchObject({ success: true, data: { postCaption } });
    expect(send.safeParse(json({ ...input, postCaption: { platform: 'reels' } })).success).toBe(false);
    expect(send.safeParse(json({ conversationId, text: 'shorter' }))).toMatchObject({ success: true });
    expect(z.object(messageExtrasShape).parse({})).not.toHaveProperty('postCaption');

    const payload = { messageId: newId<'Message'>(), conversationId, text: input.text };
    const stored = userMessageEventSchema.parse(
      json({ type: 'user.message', at: T0, payload: { ...payload, postCaption } }),
    );
    expect(stored.payload.postCaption).toEqual(postCaption);
    expect(
      userMessageEventSchema.parse(json({ type: 'user.message', at: T0, payload })).payload.postCaption,
    ).toBeUndefined();
  });
});

describe('a saved post caption (CAP1)', () => {
  it('is part of the timeline document, and a timeline without one reads as before', () => {
    const timeline = ntscTimeline();
    expect(timelineSchema.parse(json(timeline))).not.toHaveProperty('postCaptions');
    const postCaptions = [{ platform: 'instagram', text: 'A caption\n\n#one', writtenBy: 'ai' }];
    expect(timelineSchema.parse(json({ ...timeline, postCaptions })).postCaptions).toEqual(postCaptions);
    const many = Array.from({ length: MAX_POST_CAPTIONS + 1 }, () => postCaptions[0]);
    expect(timelineSchema.safeParse(json({ ...timeline, postCaptions: many })).success).toBe(false);
  });

  it('keeps a text longer than any platform takes, so a person’s long edit is kept and flagged', () => {
    const long = { platform: 'instagram', text: 'x'.repeat(POST_CAPTION_TEXT_MAX), writtenBy: 'person' };
    expect(savedPostCaptionSchema.safeParse(long).success).toBe(true);
    expect(savedPostCaptionSchema.safeParse({ ...long, text: `${long.text}x` }).success).toBe(false);
    expect(savedPostCaptionSchema.safeParse({ ...long, text: '' }).success).toBe(false);
    expect(savedPostCaptionSchema.safeParse({ ...long, writtenBy: 'model' }).success).toBe(false);
  });

  it('is set for one platform of one timeline, or removed with null', () => {
    const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>(), platform: 'instagram' };
    expect(setPostCaptionPayloadSchema.parse({ ...target, text: '  A caption  ' })).toEqual({
      ...target,
      text: 'A caption',
    });
    expect(setPostCaptionPayloadSchema.parse({ ...target, text: null, revision: 3 })).toEqual({
      ...target,
      text: null,
      revision: 3,
    });
    for (const invalid of [target, { ...target, text: '   ' }, { ...target, platform: 'x', text: 'a' }])
      expect(setPostCaptionPayloadSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('the caption credit (CAP1)', () => {
  function setup() {
    const settings = createMemorySettingsStore();
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    bus.register(...createPostCaptionCreditCommands(settings).all);
    const ports = channel();
    serveRpc(postCaptionRouter(settings), ports.port1, { context: {} });
    const client = connectRpc(postCaptionContract, ports.port2, { peer: 'agent' }).client;
    const set = (enabled: unknown, source: 'ui' | 'agent' | 'mcp' = 'ui') =>
      bus.dispatch(POST_CAPTION_SETTING_COMMANDS.setCredit, { enabled }, { source, actor: 'someone' });
    return { settings, bus, client, set };
  }

  it('is on until a person turns it off, is remembered, and undoes', async () => {
    const world = setup();
    expect(POST_CAPTION_CREDIT_SETTING.defaultValue).toBe(true);
    expect(await world.client.credit()).toEqual({ enabled: true });
    expect(await world.set(false)).toMatchObject({ ok: true, value: { result: { enabled: false } } });
    expect(await world.client.credit()).toEqual({ enabled: false });
    expect(await world.settings.get(POST_CAPTION_CREDIT_SETTING)).toEqual({ ok: true, value: false });
    expect((await world.bus.undo(null, { source: 'ui', actor: 'user' })).ok).toBe(true);
    expect(await world.client.credit()).toEqual({ enabled: true });
  });

  it('is never the model’s to decide: the agent and an MCP client are refused', async () => {
    const world = setup();
    for (const source of ['agent', 'mcp'] as const) {
      expect(await world.set(false, source)).toMatchObject({
        ok: false,
        error: { code: 'core.command_source_refused' },
      });
    }
    expect(await world.client.credit()).toEqual({ enabled: true });
    expect((await world.set('no')).ok).toBe(false);
  });
});
