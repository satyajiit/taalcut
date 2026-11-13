// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { existsSync } from 'node:fs';
import { asarUnpackedPath } from '@taalcut/library';
import { describe, expect, it } from 'vitest';
import { resolveSqliteVec } from '../src/main/native/sqlite-vec';

describe('resolveSqliteVec', () => {
  it('finds the extension for this platform', () => {
    const result = resolveSqliteVec();
    expect(result.ok).toBe(true);
    if (result.ok) {
      // sqlite-vec's per-platform package: darwin-arm64's vec0.dylib on a Mac, linux-x64's vec0.so on Linux.
      const os = process.platform === 'win32' ? 'windows' : process.platform;
      expect(result.value).toMatch(new RegExp(`sqlite-vec-${os}-${process.arch}/vec0\\.(dylib|so|dll)$`));
      expect(existsSync(result.value)).toBe(true);
    }
  });

  it('reports a missing file as vector_extension_unavailable', () => {
    const result = resolveSqliteVec(() => false);
    expect(result).toMatchObject({ ok: false, error: { code: 'library.vector_extension_unavailable' } });
  });

  it('relies on the library rewriting app.asar paths to the unpacked copy', () => {
    expect(
      asarUnpackedPath('/A/Taalcut.app/Contents/Resources/app.asar/node_modules/x/vec0.dylib', '/'),
    ).toBe('/A/Taalcut.app/Contents/Resources/app.asar.unpacked/node_modules/x/vec0.dylib');
  });
});
