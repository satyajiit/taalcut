// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { writeHandoff } from './handoff.ts';
import { cataloguePath, repoRoot, SOURCE_LOCALE } from './paths.ts';

function rootWithHi(): string {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-handoff-'));
  for (const locale of [SOURCE_LOCALE, 'hi']) {
    const file = cataloguePath(root, locale);
    mkdirSync(join(file, '..'), { recursive: true });
  }
  writeFileSync(
    cataloguePath(root, SOURCE_LOCALE),
    'msgid ""\nmsgstr ""\n"Language: en\\n"\n\nmsgid "Hello {name}"\nmsgstr "Hello {name}"\n',
  );
  writeFileSync(
    cataloguePath(root, 'hi'),
    '#. placeholder {0}: name\n#: src/hello.tsx\nmsgid "Hello {name}"\nmsgstr ""\n',
  );
  return root;
}

describe('handoff', () => {
  it('writes a po and a README that mentions placeholders and the 30% length note', () => {
    const root = rootWithHi();
    const out = join(root, 'out');
    expect(writeHandoff(root, 'hi', out).ok).toBe(true);
    const po = readFileSync(join(out, 'hi.po'), 'utf8');
    expect(po).toContain('msgid "Hello {name}"');
    expect(po).toContain('"Language: hi\\n"\n\n#.');
    expect(po).toContain('#. placeholder {0}: name');
    expect(po).toContain('#: src/hello.tsx');
    const readme = readFileSync(join(out, 'README.md'), 'utf8');
    expect(readme).toMatch(/placeholders/i);
    expect(readme).toMatch(/\{\}/);
    expect(readme).toMatch(/30%/);
    expect(readme).toMatch(/<0>/);
    expect(readme).toMatch(/select/);
  });

  it('carries the review flags, the drafter’s notes and the glossary to the reviewer', () => {
    const root = rootWithHi();
    writeFileSync(
      cataloguePath(root, 'hi'),
      '# review: formal आप?\n#. placeholder {0}: name\n#: src/hello.tsx\n#, fuzzy\nmsgid "Hello {name}"\nmsgstr "नमस्ते {name}"\n',
    );
    writeFileSync(join(cataloguePath(root, 'hi'), '..', 'glossary.md'), '# Hindi glossary\n');
    const out = join(root, 'out');
    expect(writeHandoff(root, 'hi', out).ok).toBe(true);
    expect(readFileSync(join(out, 'hi.po'), 'utf8')).toContain(
      '# review: formal आप?\n#. placeholder {0}: name\n#: src/hello.tsx\n#, fuzzy\nmsgid "Hello {name}"',
    );
    const readme = readFileSync(join(out, 'README.md'), 'utf8');
    expect(readme).toContain('1 of 1 messages are translated. 1 of them are drafts marked `#, fuzzy`');
    expect(readme).toContain('GLOSSARY.md');
    expect(readFileSync(join(out, 'GLOSSARY.md'), 'utf8')).toBe('# Hindi glossary\n');
  });

  it('hands main’s catalogue (menu, notifications, macOS prompts) over beside the window’s', () => {
    const root = rootWithHi();
    for (const locale of [SOURCE_LOCALE, 'hi']) {
      mkdirSync(join(cataloguePath(root, locale, 'main'), '..'), { recursive: true });
      writeFileSync(
        cataloguePath(root, locale, 'main'),
        `#. js-lingui-explicit-id\nmsgid "menu.edit"\nmsgstr "${locale === 'hi' ? '' : 'Edit'}"\n`,
      );
    }
    const out = join(root, 'out');
    expect(writeHandoff(root, 'hi', out).ok).toBe(true);
    const main = readFileSync(join(out, 'hi.main.po'), 'utf8');
    expect(main).toContain('#. source: Edit\nmsgid "menu.edit"\nmsgstr ""');
    expect(readFileSync(join(out, 'README.md'), 'utf8')).toContain('0 of 2 messages are translated');
  });

  it('refuses an unknown locale from the CLI', () => {
    const out = mkdtempSync(join(tmpdir(), 'taalcut-handoff-out-'));
    const proc = spawnSync(
      process.execPath,
      [join(repoRoot(), 'scripts/i18n.mjs'), 'handoff', 'zz', '--out', out],
      {
        encoding: 'utf8',
      },
    );
    expect(proc.status).toBe(1);
    expect(proc.stderr).toMatch(/Unknown locale: zz/);
  });
});
