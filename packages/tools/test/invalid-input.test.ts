// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT1: a refused call's detail shows the model its own call with each refused field mended. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { correctedExample, invalidInputDetail, parseToolInput } from '../src/invalid-input';

const handoff = z.object({
  templateId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  version: z.int().min(1),
  shot: z.enum(['wide', 'close']),
  note: z.string().max(12).optional(),
});

describe('a refused call, mended', () => {
  it('mends each refused field and keeps the rest', () => {
    const input = { templateId: '', version: 0, shot: 'Close', note: 'a long note that runs on' };
    const parsed = handoff.safeParse(input);
    expect(parsed.success).toBe(false);
    expect(correctedExample(input, parsed.error!)).toEqual({
      templateId: '<the id or value a tool returned>',
      version: 1,
      shot: 'close',
      note: 'a long note',
    });
    const detail = invalidInputDetail(input, parsed.error!);
    expect(detail).toContain('✖');
    expect(detail).toContain(
      'Your call with those fields mended: {"templateId":"<the id or value a tool returned>"',
    );
  });

  it('says what goes in a missing field, and lists the fields of a long call', () => {
    const input = { version: 2, shot: 'wide', note: 'x', filler: 'y'.repeat(2_000) };
    const parsed = handoff.safeParse(input);
    const detail = invalidInputDetail(input, parsed.error!);
    expect(detail).toContain(
      'Mend these fields of your call and send it again: templateId: "<string: required>"',
    );
  });

  it('adds nothing when no field can be mended', () => {
    const one = z
      .object({ a: z.string().optional(), b: z.string().optional() })
      .refine((v) => !(v.a && v.b), 'Give one');
    const parsed = one.safeParse({ a: 'x', b: 'y' });
    expect(invalidInputDetail({ a: 'x', b: 'y' }, parsed.error!)).toBe(z.prettifyError(parsed.error!));
  });
});

describe('an array sent as a JSON string (AGT1)', () => {
  const intents = z.object({
    breakdownId: z.string(),
    intents: z.array(z.object({ slotIndex: z.int(), intent: z.object({ text: z.string() }) })),
  });

  it('is parsed where the schema wants the array, also when it nests', () => {
    const sent = {
      breakdownId: 'b',
      intents: JSON.stringify([{ slotIndex: 0, intent: { text: 'a walk' } }]),
    };
    expect(parseToolInput(intents, sent)).toMatchObject({
      success: true,
      data: { intents: [{ slotIndex: 0, intent: { text: 'a walk' } }] },
    });
    const nested = {
      breakdownId: 'b',
      intents: JSON.stringify([{ slotIndex: 0, intent: JSON.stringify({ text: 'x' }) }]),
    };
    expect(parseToolInput(intents, nested).success).toBe(true);
  });

  it('is refused as before when it does not parse, and the example says to send the array itself', () => {
    const sent = { breakdownId: 'b', intents: '[{"slotIndex": 0]' };
    const parsed = parseToolInput(intents, sent);
    expect(parsed.success).toBe(false);
    expect(invalidInputDetail(sent, parsed.error!)).toContain(
      '"intents":"<the JSON array itself, not a string holding it>"',
    );
  });
});

describe('an empty string a field may not be (AGT1)', () => {
  const intent = z.object({ text: z.string().min(1), reel: z.string().min(1).optional() });

  it('is left out where the field is optional', () => {
    expect(parseToolInput(intent, { text: 'a walk', reel: '' })).toMatchObject({
      success: true,
      data: { text: 'a walk' },
    });
    expect(parseToolInput(intent, { text: 'a walk', reel: '' }).data).not.toHaveProperty('reel');
  });

  it('is refused as before where the field is required', () => {
    const parsed = parseToolInput(intent, { text: '' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]).toMatchObject({ code: 'too_small', path: ['text'] });
  });
});
