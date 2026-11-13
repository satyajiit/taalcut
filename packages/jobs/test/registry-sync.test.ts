// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * installedComponentDirSync: the installed folder from registry.json, read
 * synchronously for module loaders; nothing for a missing component, a
 * deleted folder, or a missing or corrupt registry, which it never touches.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installedComponentDirSync } from '../src/index';
import { MIT_LICENCE } from './helpers/fixtures';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-registry-sync-'));
  roots.push(dir);
  return dir;
}

const entry = (id: string, dir: string, file?: string) => ({
  id,
  version: '1.30.0',
  sha256: 'a'.repeat(64),
  platform: 'darwin-arm64',
  dir,
  ...(file ? { file } : {}),
  bytes: 1,
  installedAt: '2026-10-13T00:00:00.000Z',
  licence: MIT_LICENCE,
  notice: 'TAALCUT-NOTICE.txt',
});

describe('installedComponentDirSync', () => {
  it("returns an installed component's folder", () => {
    const components = root();
    const dir = 'installed/onnxruntime/1.30.0-aaaaaaaaaaaa';
    mkdirSync(join(components, dir), { recursive: true });
    mkdirSync(join(components, 'installed/whisper-cpp/1-aaaaaaaaaaaa'), { recursive: true });
    writeFileSync(join(components, 'installed/whisper-cpp/1-aaaaaaaaaaaa/whisper-cli'), '');
    writeFileSync(
      join(components, 'registry.json'),
      JSON.stringify({
        schemaVersion: 1,
        components: {
          onnxruntime: entry('onnxruntime', dir),
          'whisper-cpp': entry('whisper-cpp', 'installed/whisper-cpp/1-aaaaaaaaaaaa', 'whisper-cli'),
          'whisper-tiny': entry('whisper-tiny', 'installed/whisper-tiny/gone', 'ggml-tiny.bin'),
        },
      }),
    );
    expect(installedComponentDirSync(components, 'onnxruntime')).toBe(join(components, dir));
    expect(installedComponentDirSync(components, 'whisper-cpp')).toBe(
      join(components, 'installed/whisper-cpp/1-aaaaaaaaaaaa'),
    );
    // In the registry, but its file is gone.
    expect(installedComponentDirSync(components, 'whisper-tiny')).toBeUndefined();
    expect(installedComponentDirSync(components, 'beat-this')).toBeUndefined();
  });

  it('is undefined without a registry or with a corrupt one, and leaves it alone', () => {
    const components = root();
    expect(installedComponentDirSync(components, 'onnxruntime')).toBeUndefined();
    writeFileSync(join(components, 'registry.json'), '{ not json');
    expect(installedComponentDirSync(components, 'onnxruntime')).toBeUndefined();
    expect(readFileSync(join(components, 'registry.json'), 'utf8')).toBe('{ not json');
  });
});
