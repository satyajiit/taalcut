// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { transferPhoneDir } from '../src/utility/transfer-phone';

function fileUrl(path: string): string {
  return pathToFileURL(path).href;
}

describe('transfer phone directory', () => {
  it('finds the phone page from the source utility module', () => {
    const dir = transferPhoneDir(fileUrl(join(import.meta.dirname, '../src/utility/transfer-phone.ts')));
    expect(dir.endsWith(join('packages', 'transfer', 'phone'))).toBe(true);
  });

  it('finds the same page from a compiled utility bundle path', () => {
    const dir = transferPhoneDir(fileUrl(join(import.meta.dirname, '../out/utility/lan.mjs')));
    expect(dir.endsWith(join('packages', 'transfer', 'phone'))).toBe(true);
  });
});
