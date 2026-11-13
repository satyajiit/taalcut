// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * vision.matchLook is offered to the model, so its input (zod's input side) and output (its output side) must
 * convert to JSON Schema as the tool registry converts them (packages/tools `exportToolSchemas`): an id written with
 * core's custom `idSchema` check can't, and the registry would refuse the whole `vision` module.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { matchLookInputSchema, matchLookOutputSchema } from '../../src/look/look-tools';

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

describe('vision.matchLook schemas', () => {
  it('convert to JSON Schema the way the tool registry asks', () => {
    const convert = (schema: z.ZodType, io: 'input' | 'output') =>
      z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'throw' });
    expect(() => convert(matchLookInputSchema, 'input')).not.toThrow();
    expect(() => convert(matchLookOutputSchema, 'output')).not.toThrow();
  });

  it('still accept only ULIDs for ids', () => {
    expect(matchLookInputSchema.safeParse({ source: { templateId: ULID } }).success).toBe(true);
    expect(matchLookInputSchema.safeParse({ source: { templateId: 'template-1' } }).success).toBe(false);
  });
});
