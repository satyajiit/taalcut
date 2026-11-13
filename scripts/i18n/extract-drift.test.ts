// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkExtractDrift } from './extract-drift.ts';

describe('extract drift', () => {
  it('restores catalogue bytes when extract changes them', () => {
    const root = mkdtempSync(join(tmpdir(), 'taalcut-drift-'));
    const locales = join(root, 'locales');
    const file = join(locales, 'en', 'messages.po');
    mkdirSync(join(locales, 'en'), { recursive: true });
    writeFileSync(file, 'original\n');
    const added = join(locales, 'hi', 'messages.po');

    const result = checkExtractDrift(locales, () => {
      writeFileSync(file, 'changed\n');
      mkdirSync(join(locales, 'hi'), { recursive: true });
      writeFileSync(added, 'new\n');
      return { status: 0, stdout: '', stderr: '' };
    });

    expect(result.ok).toBe(false);
    expect(result.files.map((item) => item.endsWith('messages.po')).every(Boolean)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('original\n');
    expect(existsSync(added)).toBe(false);
  });

  it('leaves bytes alone when extract is a no-op', () => {
    const root = mkdtempSync(join(tmpdir(), 'taalcut-drift-'));
    const locales = join(root, 'locales');
    const file = join(locales, 'en', 'messages.po');
    mkdirSync(dirnameOf(file), { recursive: true });
    writeFileSync(file, 'same\n');
    const result = checkExtractDrift(locales, () => ({ status: 0, stdout: '', stderr: '' }));
    expect(result.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('same\n');
  });
});

function dirnameOf(file: string): string {
  return join(file, '..');
}
