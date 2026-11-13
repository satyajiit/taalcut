// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { castingJsonSchema, parseCastingWeights } from '../../src/casting/schema';

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '../../schema/casting.schema.json');

describe('casting schema', () => {
  it('matches the committed JSON Schema and keeps order rules as group ids', () => {
    const exported = `${JSON.stringify(castingJsonSchema(), null, 2)}\n`;
    expect(exported).toBe(readFileSync(schemaPath, 'utf8'));
    expect(exported).toContain('before');
    expect(exported).toContain('groups');
    expect(parseCastingWeights({ version: '1', intent: 0.6, motion: 0, quality: 0, subject: 0, energy: 1 }).intent).toBe(0.6);
  });
});
