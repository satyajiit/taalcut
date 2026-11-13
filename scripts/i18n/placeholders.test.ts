// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { summariseWarnings } from './cli.ts';
import { checkPlaceholders, placeholderProblem } from './placeholders.ts';

const HEADER = 'msgid ""\nmsgstr ""\n"Language: en\\n"\n\n';

function tree(entries: Record<string, string>): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-placeholders-'));
  const dir = join(root, 'locales');
  const ids = Object.keys(entries);
  mkdirSync(join(dir, 'en'), { recursive: true });
  mkdirSync(join(dir, 'es'), { recursive: true });
  const po = (msgstr: (id: string) => string): string =>
    HEADER +
    ids.map((id) => `msgid ${JSON.stringify(id)}\nmsgstr ${JSON.stringify(msgstr(id))}\n`).join('\n');
  writeFileSync(
    join(dir, 'en', 'messages.po'),
    po((id) => id),
  );
  writeFileSync(
    join(dir, 'es', 'messages.po'),
    po((id) => entries[id] ?? ''),
  );
  return { root, dir };
}

describe('placeholders', () => {
  it('flags a renamed placeholder and a dropped tag', () => {
    expect(placeholderProblem('Hello {name}', 'Hola {nombre}')).toMatch(/missing name; unexpected nombre/);
    expect(placeholderProblem('Uses <0>{model}</0>.', 'Usa {model}.')).toMatch(/tags \(none\) instead of/);
    expect(placeholderProblem('Uses <0>{model}</0>.', 'Usa <0>{model}</0>.')).toBeUndefined();
  });

  it('accepts the extra plural branch a locale needs', () => {
    expect(
      placeholderProblem(
        '{0, plural, one {<0>#</0> clip} other {<0>#</0> clips}}',
        '{0, plural, one {<0>#</0> clip} many {<0>#</0> clips} other {<0>#</0> clips}}',
      ),
    ).toBeUndefined();
  });

  it('checks committed catalogues, not only imports', () => {
    const { root, dir } = tree({
      'Hello {name}': 'Hola {nombre}',
      'Bye {name}': 'Adiós {name}',
      Untranslated: '',
    });
    const findings = checkPlaceholders(root, dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe('Hello {name}');
    expect(findings[0]?.file).toBe('locales/es/messages.po');
  });

  it('summarises missing-translation warnings per catalogue', () => {
    const warning = { file: 'hi/messages.po', line: 1, id: 'a', message: 'missing translation' };
    expect(summariseWarnings([warning, { ...warning, id: 'b' }])).toEqual([
      'hi/messages.po: 2 missing translation(s), allowed until signed-off',
    ]);
  });
});
