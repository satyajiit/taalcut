// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkFreeze, writeManifest } from './freeze.ts';
import { cataloguePath, frozenPath, SOURCE_LOCALE } from './paths.ts';

function rootWith(po: string): string {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-freeze-'));
  const file = cataloguePath(root, SOURCE_LOCALE);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, po);
  return root;
}

const ORIGINAL = [
  'msgid ""',
  'msgstr ""',
  '"Language: en\\n"',
  '',
  'msgid "Beta"',
  'msgstr "Beta"',
  '',
  '#. js-lingui-explicit-id',
  'msgid "greeting"',
  'msgstr "Hello there"',
  '',
].join('\n');

describe('string freeze', () => {
  it('fails when a frozen source changes, and unfreeze rewrites the manifest', () => {
    const root = rootWith(ORIGINAL);
    expect(writeManifest(root).ok).toBe(true);
    const changed = ORIGINAL.replace('msgstr "Hello there"', 'msgstr "Hi there"');
    writeFileSync(cataloguePath(root, SOURCE_LOCALE), changed);
    const findings = checkFreeze(root);
    expect(
      findings.some((finding) => finding.id === 'greeting' && finding.message.includes('unfreeze')),
    ).toBe(true);

    const extra = `${changed}\nmsgid "New"\nmsgstr "New"\n`;
    writeFileSync(cataloguePath(root, SOURCE_LOCALE), extra);
    const withNew = checkFreeze(root);
    expect(withNew.some((finding) => finding.id === 'New')).toBe(false);

    expect(writeManifest(root).ok).toBe(true);
    const text = readFileSync(frozenPath(root), 'utf8');
    const keys = Object.keys(JSON.parse(text) as Record<string, string>);
    expect(keys).toEqual(['Beta', 'New', 'greeting']);
    expect(text).toContain('"Hi there"');
    expect(checkFreeze(root)).toEqual([]);
  });

  it('freezes an explicit id and a source sentence with the same words once, and refuses two Englishes', () => {
    const twin = `${ORIGINAL}\n#. js-lingui-explicit-id\nmsgid "Beta"\nmsgstr "Beta"\n`;
    const root = rootWith(twin);
    expect(writeManifest(root).ok).toBe(true);
    const frozen = JSON.parse(readFileSync(frozenPath(root), 'utf8')) as Record<string, string>;
    expect(frozen).toEqual({ Beta: 'Beta', greeting: 'Hello there' });
    expect(checkFreeze(root)).toEqual([]);

    writeFileSync(cataloguePath(root, SOURCE_LOCALE), twin.replace(/msgstr "Beta"\n$/, 'msgstr "Beta 2"\n'));
    const refused = writeManifest(root);
    expect(refused.ok).toBe(false);
  });
});
