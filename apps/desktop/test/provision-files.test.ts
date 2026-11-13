// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * e2e:provision's component files (e2e/provision-files.ts). A download gets the manifest's install mode, 0755 for a
 * single file marked executable and 0644 for the rest, whatever the umask, and is renamed only once it has it. A file
 * already in the cache is right only with the right bytes and mode; right bytes with the wrong mode get the mode.
 * UX2 round 6: whisper-server and whisper-cli were provisioned 0644 and never repaired, and the audio tests that fall
 * back to the cache ran a binary the OS refused to start.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { download, holds, installMode, type Artifact } from '../e2e/provision-files';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const cache = () => {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-provision-'));
  dirs.push(dir);
  return dir;
};

const BYTES = Buffer.from('#!/bin/sh\necho whisper-server\n');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const URL_A = 'https://components.taalcut.app/whisper-server/1/whisper-server';
const URL_B = 'https://mirror.taalcut.app/whisper-server/1/whisper-server';

const tool: Artifact = {
  platform: 'darwin-arm64',
  urls: [URL_A],
  sha256: SHA,
  size: BYTES.length,
  install: { type: 'file', fileName: 'whisper-server', executable: true },
};
const model: Artifact = { ...tool, install: { type: 'file', fileName: 'ggml-tiny.bin', executable: false } };
const packed: Artifact = {
  ...tool,
  install: { type: 'archive', format: 'tar.zst', stripComponents: 0, extractedSize: 1 },
};

const serving = (bytes: Buffer) => async () => new Response(new Uint8Array(bytes));
const modeOf = (path: string) => statSync(path).mode & 0o777;

describe('a provisioned file', () => {
  it('takes the manifest’s install mode: executable for a tool, not for a model or an archive', () => {
    expect([installMode(tool), installMode(model), installMode(packed)]).toEqual([0o755, 0o644, 0o644]);
  });

  it('is downloaded with that mode whatever the umask, and nothing is left beside it', async () => {
    const dir = cache();
    const before = process.umask(0o077);
    try {
      for (const [artifact, name] of [
        [tool, 'whisper-server'],
        [model, 'ggml-tiny.bin'],
        [packed, 'beat-this.tar.zst'],
      ] as const) {
        const target = join(dir, name);
        expect(await download(artifact, target, serving(BYTES))).toEqual({ url: URL_A, size: BYTES.length });
        expect(readFileSync(target)).toEqual(BYTES);
        expect(modeOf(target)).toBe(installMode(artifact));
        expect(existsSync(`${target}.partial`)).toBe(false);
      }
    } finally {
      process.umask(before);
    }
  });

  it('comes from the next URL when one doesn’t answer, and is refused with other bytes', async () => {
    const dir = cache();
    const warned: string[] = [];
    const target = join(dir, 'whisper-server');
    const mirrored: Artifact = { ...tool, urls: [URL_A, URL_B] };
    const fetchUrl = async (url: string) =>
      url === URL_A ? new Response('gone', { status: 404 }) : new Response(new Uint8Array(BYTES));
    expect(await download(mirrored, target, fetchUrl, (line) => warned.push(line))).toEqual({
      url: URL_B,
      size: BYTES.length,
    });
    expect(warned).toEqual([`${URL_A} answered 404`]);
    const other = join(dir, 'other');
    await expect(download(tool, other, serving(Buffer.from('something else')))).rejects.toThrow(
      /sent 14 bytes, sha256 [0-9a-f]{64}; the manifest says/,
    );
    expect(existsSync(other) || existsSync(`${other}.partial`)).toBe(false);
  });

  it('already in the cache is right only with its bytes and mode, and a wrong mode is set right', async () => {
    const dir = cache();
    const path = join(dir, 'whisper-server');
    expect(await holds(path, tool)).toEqual({ state: 'absent' });
    writeFileSync(path, BYTES);
    chmodSync(path, 0o644);
    // What the gate's cache held: right bytes, not executable.
    expect(await holds(path, tool)).toEqual({ state: 'repaired', from: 0o644 });
    expect(modeOf(path)).toBe(0o755);
    expect(await holds(path, tool)).toEqual({ state: 'right' });
    writeFileSync(path, 'other bytes');
    expect(await holds(path, tool)).toEqual({ state: 'other' });
  });
});
