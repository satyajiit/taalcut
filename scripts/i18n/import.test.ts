// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { importCatalogue } from './import.ts';
import { cataloguePath, SOURCE_LOCALE } from './paths.ts';

function setup(): { root: string; from: string; target: string; original: string } {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-import-'));
  const from = join(root, 'from');
  mkdirSync(from, { recursive: true });
  const en = cataloguePath(root, SOURCE_LOCALE);
  const hi = cataloguePath(root, 'hi');
  mkdirSync(join(en, '..'), { recursive: true });
  mkdirSync(join(hi, '..'), { recursive: true });
  writeFileSync(
    en,
    'msgid ""\nmsgstr ""\n"Language: en\\n"\n\nmsgid "Hello {name}"\nmsgstr "Hello {name}"\n',
  );
  const original = '#. keep me\n#: src/a.tsx\nmsgid "Hello {name}"\nmsgstr ""\n';
  writeFileSync(hi, original);
  return { root, from, target: hi, original };
}

describe('import', () => {
  it('rejects a changed msgid and merges a valid msgstr', () => {
    const { root, from, target, original } = setup();
    writeFileSync(join(from, 'hi.po'), 'msgid "Hello {name}!"\nmsgstr "Hola {name}"\n');
    const rejected = importCatalogue(root, 'hi', from);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.errors[0]?.id).toBe('Hello {name}!');
    expect(rejected.errors[0]?.message).toMatch(/msgid/);
    expect(readFileSync(target, 'utf8')).toBe(original);

    writeFileSync(join(from, 'hi.po'), 'msgid "Hello {name}"\nmsgstr "Hola {name}"\n');
    const merged = importCatalogue(root, 'hi', from);
    expect(merged.exitCode).toBe(0);
    const next = readFileSync(target, 'utf8');
    expect(next).toContain('#. keep me');
    expect(next).toContain('#: src/a.tsx');
    expect(next).toContain('msgid "Hello {name}"');
    expect(next).toContain('msgstr "Hola {name}"');
  });

  it('keeps a translation the returned file leaves blank, and refuses a dropped tag', () => {
    const { root, from, target } = setup();
    writeFileSync(join(from, 'hi.po'), 'msgid "Hello {name}"\nmsgstr "Namaste {name}"\n');
    expect(importCatalogue(root, 'hi', from).exitCode).toBe(0);

    writeFileSync(join(from, 'hi.po'), 'msgid "Hello {name}"\nmsgstr ""\n');
    expect(importCatalogue(root, 'hi', from).exitCode).toBe(0);
    expect(readFileSync(target, 'utf8')).toContain('msgstr "Namaste {name}"');

    writeFileSync(join(from, 'hi.po'), 'msgid "Hello {name}"\nmsgstr "Namaste <0>{name}</0>"\n');
    const rejected = importCatalogue(root, 'hi', from);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.errors[0]?.message).toMatch(/tags <\/0> <0> instead of \(none\)/);
  });

  it('takes the review flag and the translator notes from the returned file, in Lingui’s order', () => {
    const { root, from, target } = setup();
    writeFileSync(
      join(from, 'hi.po'),
      '# review: formal or informal?\n#, fuzzy\nmsgid "Hello {name}"\nmsgstr "नमस्ते {name}"\n',
    );
    expect(importCatalogue(root, 'hi', from).exitCode).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(
      '# review: formal or informal?\n#. keep me\n#: src/a.tsx\n#, fuzzy\nmsgid "Hello {name}"\nmsgstr "नमस्ते {name}"\n',
    );

    // The reviewer approved it: no flag, the question answered and deleted.
    writeFileSync(join(from, 'hi.po'), 'msgid "Hello {name}"\nmsgstr "नमस्ते, {name}"\n');
    expect(importCatalogue(root, 'hi', from).exitCode).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(
      '#. keep me\n#: src/a.tsx\nmsgid "Hello {name}"\nmsgstr "नमस्ते, {name}"\n',
    );
  });

  it('refuses a line break the English does not have', () => {
    const { root, from } = setup();
    writeFileSync(join(from, 'hi.po'), 'msgid "Hello {name}"\nmsgstr "नमस्ते\\n{name}"\n');
    const rejected = importCatalogue(root, 'hi', from);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.errors[0]?.message).toMatch(/line break/);
  });

  it('merges main’s returned catalogue too, and writes nothing while either file is wrong', () => {
    const { root, from, target, original } = setup();
    for (const locale of [SOURCE_LOCALE, 'hi']) {
      mkdirSync(join(cataloguePath(root, locale, 'main'), '..'), { recursive: true });
      writeFileSync(
        cataloguePath(root, locale, 'main'),
        `#. js-lingui-explicit-id\nmsgid "menu.edit"\nmsgstr "${locale === 'hi' ? '' : 'Edit'}"\n`,
      );
    }
    const mainBefore = readFileSync(cataloguePath(root, 'hi', 'main'), 'utf8');
    writeFileSync(join(from, 'hi.po'), 'msgid "Hello {name}"\nmsgstr "नमस्ते {name}"\n');
    writeFileSync(join(from, 'hi.main.po'), 'msgid "menu.edit"\nmsgstr "संपादन {oops}"\n');
    const rejected = importCatalogue(root, 'hi', from);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.errors[0]?.message).toMatch(/unexpected oops/);
    expect(readFileSync(target, 'utf8')).toBe(original);
    expect(readFileSync(cataloguePath(root, 'hi', 'main'), 'utf8')).toBe(mainBefore);

    writeFileSync(join(from, 'hi.main.po'), '#, fuzzy\nmsgid "menu.edit"\nmsgstr "संपादन"\n');
    expect(importCatalogue(root, 'hi', from).exitCode).toBe(0);
    expect(readFileSync(target, 'utf8')).toContain('msgstr "नमस्ते {name}"');
    expect(readFileSync(cataloguePath(root, 'hi', 'main'), 'utf8')).toBe(
      '#. js-lingui-explicit-id\n#, fuzzy\nmsgid "menu.edit"\nmsgstr "संपादन"\n',
    );
  });
});
