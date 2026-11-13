// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSearchQuery, searchJsonSchema } from '../../src/search/schema';

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '../../schema/search.schema.json');

describe('search schema', () => {
  it('round-trips a query and matches the committed JSON Schema', () => {
    const query = parseSearchQuery({
      queryId: 'beach-sunset',
      language: 'pt-BR',
      library: 'library-id',
      text: 'praia',
      relevant: [{ asset: 'clips/beach.mov' }],
      synthetic: false,
    });
    expect(query.language).toBe('pt-BR');
    expect(query.relevant[0]?.range).toBeUndefined();
    const exported = `${JSON.stringify(searchJsonSchema(), null, 2)}\n`;
    expect(exported).toBe(readFileSync(schemaPath, 'utf8'));
    expect(exported).toContain('pt-BR');
  });
});
