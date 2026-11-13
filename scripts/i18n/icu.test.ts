// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { formatFinding } from './finding.ts';
import { checkIcu, validateMessage } from './icu.ts';
import { cardinalCategories } from './plurals.ts';

function catalogue(id: string, msgstr = id): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-icu-'));
  const dir = join(root, 'locales');
  mkdirSync(join(dir, 'en'), { recursive: true });
  const body = `msgid ""\nmsgstr ""\n"Language: en\\n"\n\nmsgid ${JSON.stringify(id)}\nmsgstr ${JSON.stringify(msgstr)}\n`;
  writeFileSync(join(dir, 'en', 'messages.po'), body);
  return { root, dir };
}

describe('ICU', () => {
  it('reports a broken brace with file, line, and id', () => {
    const id = 'Hello {name';
    const { root, dir } = catalogue(id);
    const findings = checkIcu(root, dir);
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.line).toBe(5);
    expect(finding?.id).toBe(id);
    expect(finding?.message).toMatch(/broken ICU syntax: Unexpected message end/);
    expect(formatFinding(finding ?? { file: '', line: 0, id: '', message: '' })).toMatch(
      /messages\.po:5: Hello \{name: broken ICU/,
    );
  });

  it('reports a plural that is missing other', () => {
    const id = '{n, plural, one {# item}}';
    const { root, dir } = catalogue(id);
    const findings = checkIcu(root, dir);
    expect(findings.some((finding) => finding.id === id && finding.message.includes('"other"'))).toBe(true);
    expect(findings[0]?.line).toBe(5);
  });

  it('reports a plural that is missing one for English', () => {
    const id = '{n, plural, other {# items}}';
    const { root, dir } = catalogue(id);
    const findings = checkIcu(root, dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe(id);
    expect(findings[0]?.line).toBe(5);
    expect(findings[0]?.message).toMatch(/plural is missing "one"/);
  });

  it('does not require a category that only European Portuguese would', () => {
    expect(cardinalCategories('pt-BR')).toEqual(['one', 'many', 'other']);
    expect(cardinalCategories('pt-BR')).not.toContain('zero');
    expect(validateMessage('{n, plural, one {#} many {#} other {#}}', 'pt-BR')).toEqual([]);
    expect(
      validateMessage('{n, plural, zero {none} one {#} many {#} other {#}}', 'pt-BR').join('\n'),
    ).toMatch(/zero/);
  });
});
