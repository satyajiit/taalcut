// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** CVR1: a cover asked for in the editor's cover panel travels on the message as data, with its aspect. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  chatContract,
  COVER_NOTE_MAX,
  coverRequestSchema,
  messageExtrasShape,
  newId,
  THUMBNAIL_ASPECTS,
  userMessageEventSchema,
  type CoverRequest,
  type ThumbnailAspect,
} from '@taalcut/core';
import { at, json, T0 } from './helpers/documents';

describe('a cover request (CVR1)', () => {
  it('names one of the four cover aspects and keeps the note to one trimmed line', () => {
    expectTypeOf<CoverRequest['aspect']>().toEqualTypeOf<ThumbnailAspect>();
    for (const aspect of THUMBNAIL_ASPECTS) expect(coverRequestSchema.parse({ aspect })).toEqual({ aspect });
    expect(coverRequestSchema.parse({ aspect: '4:5', note: '  The night market, big title  ' })).toEqual({
      aspect: '4:5',
      note: 'The night market, big title',
    });
    expect(coverRequestSchema.parse({ aspect: '1:1', note: 'x'.repeat(COVER_NOTE_MAX) }).note).toHaveLength(
      COVER_NOTE_MAX,
    );
    for (const invalid of [
      {},
      { aspect: '3:2' },
      { aspect: '9:16', note: '' },
      { aspect: '9:16', note: '   ' },
      { aspect: '9:16', note: 'x'.repeat(COVER_NOTE_MAX + 1) },
      { note: 'A title' },
    ])
      expect(coverRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('goes with a sent message and stays on the stored one; a message without it reads as before', () => {
    const conversationId = newId<'Conversation'>();
    const cover = { aspect: '16:9', note: 'The harbour at dusk' };
    const editorContext = { timelineId: newId<'Timeline'>(), revision: 2, playhead: at(0), selection: [] };
    const input = { conversationId, text: 'Generate a 16:9 cover for this video.', editorContext, cover };
    const send = chatContract.send['~orpc'].inputSchema!;
    expect(send.safeParse(json(input))).toMatchObject({ success: true, data: { cover } });
    expect(send.safeParse(json({ ...input, cover: { aspect: 'wide' } })).success).toBe(false);
    expect(send.safeParse(json({ conversationId, text: 'shorter' }))).toMatchObject({ success: true });
    expect(z.object(messageExtrasShape).parse({})).not.toHaveProperty('cover');

    const payload = { messageId: newId<'Message'>(), conversationId, text: input.text };
    const stored = userMessageEventSchema.parse(
      json({ type: 'user.message', at: T0, payload: { ...payload, cover } }),
    );
    expect(stored.payload.cover).toEqual(cover);
    expect(
      userMessageEventSchema.parse(json({ type: 'user.message', at: T0, payload })).payload.cover,
    ).toBeUndefined();
  });
});
