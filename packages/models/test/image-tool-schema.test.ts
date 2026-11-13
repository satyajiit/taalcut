// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `images.generateForSlot` is offered to the model, so its input and output must convert to JSON Schema the way
 * the tool registry converts them (packages/tools `exportToolSchemas`): an id written with core's custom
 * `idSchema` check can't, and the registry would refuse the whole `images` module.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generateForSlotInput, generateForSlotOutput } from '../src/images/image-tool-io';

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

describe('images.generateForSlot schemas', () => {
  it.each([
    ['input', generateForSlotInput],
    ['output', generateForSlotOutput],
  ] as const)('%s converts to JSON Schema, both sides', (_name, schema) => {
    for (const io of ['input', 'output'] as const) {
      expect(() =>
        z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'throw' }),
      ).not.toThrow();
    }
  });

  it('still accepts only ULIDs for its ids', () => {
    const input = { projectId: ULID, timelineId: ULID, slotId: ULID, prompt: 'A beach at dusk' };
    expect(generateForSlotInput.safeParse(input).success).toBe(true);
    expect(generateForSlotInput.safeParse({ ...input, slotId: 'slot-1' }).success).toBe(false);
  });
});
