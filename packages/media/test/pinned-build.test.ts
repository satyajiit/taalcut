// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The FFmpeg builds pinned in @taalcut/media (one per platform), and the Mach-O hash they use: one that
 * packaging's re-signing leaves alone and any other change moves.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bundleFiles,
  createBinaryResolver,
  FFMPEG_BUILD_TARGETS,
  PINNED_FFMPEG_BUILD,
  pinBuild,
  signatureFreeDigest,
  signatureFreeSha256,
  type FfmpegBuildTarget,
} from '@taalcut/media';

const DISTS = fileURLToPath(new URL('../../../tools/ffmpeg/dist/', import.meta.url));
const DIST = DISTS;
const MAC = FFMPEG_BUILD_TARGETS['darwin-arm64'];
const LINUX = FFMPEG_BUILD_TARGETS['linux-x64'];
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** A target's dist folder holds the binaries its committed BUILDINFO.json describes. */
function distBuilt(target: FfmpegBuildTarget): boolean {
  const dir = join(DISTS, target.devFolder);
  const binaries = bundleFiles(target, false).slice(0, 2);
  if (!binaries.every(([, path]) => existsSync(join(dir, path)))) return false;
  const info = JSON.parse(readFileSync(join(dir, 'BUILDINFO.json'), 'utf8')) as {
    outputs: { name: string; sha256: string }[];
  };
  const expected = Object.fromEntries(info.outputs.map((output) => [output.name, output.sha256]));
  return binaries.every(([name, path]) => sha(readFileSync(join(dir, path))) === expected[name]);
}
const BUILT = distBuilt(MAC);
const LINUX_BUILT = distBuilt(LINUX);

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A minimal thin arm64 Mach-O: __LINKEDIT and a code signature over `body`. */
function machO(body: Buffer, signature: Buffer): Buffer {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_ARM64
  header.writeUInt32LE(2, 12); // MH_EXECUTE
  header.writeUInt32LE(2, 16); // ncmds
  header.writeUInt32LE(72 + 16, 20); // sizeofcmds
  const linkedit = Buffer.alloc(72);
  linkedit.writeUInt32LE(0x19, 0);
  linkedit.writeUInt32LE(72, 4);
  linkedit.write('__LINKEDIT', 8, 'latin1');
  const dataoff = 32 + 72 + 16 + body.length;
  linkedit.writeBigUInt64LE(BigInt(body.length + signature.length), 32); // vmsize
  linkedit.writeBigUInt64LE(BigInt(body.length + signature.length), 48); // filesize
  const codeSignature = Buffer.alloc(16);
  codeSignature.writeUInt32LE(0x1d, 0);
  codeSignature.writeUInt32LE(16, 4);
  codeSignature.writeUInt32LE(dataoff, 8);
  codeSignature.writeUInt32LE(signature.length, 12);
  return Buffer.concat([header, linkedit, codeSignature, body, signature]);
}

describe('signatureFreeDigest', () => {
  const body = Buffer.from('code and data the kernel maps');
  const signed = machO(body, Buffer.alloc(64, 1));

  it('ignores the signature and the sizes signing rewrites', () => {
    expect(signatureFreeDigest(machO(body, Buffer.alloc(9000, 7)))).toBe(signatureFreeDigest(signed));
    expect(sha(machO(body, Buffer.alloc(9000, 7)))).not.toBe(sha(signed));
  });

  it('covers every other byte, including where the signature starts', () => {
    const changed = Buffer.from(signed);
    const at = 32 + 72 + 16 + 3;
    changed.writeUInt8(changed.readUInt8(at) ^ 1, at);
    expect(signatureFreeDigest(changed)).not.toBe(signatureFreeDigest(signed));
    expect(signatureFreeDigest(machO(Buffer.concat([body, Buffer.from('!')]), Buffer.alloc(64, 1)))).not.toBe(
      signatureFreeDigest(signed),
    );
    const moved = Buffer.from(signed);
    moved.writeUInt32LE(moved.readUInt32LE(32 + 72 + 8) - 1, 32 + 72 + 8);
    expect(signatureFreeDigest(moved)).not.toBe(signatureFreeDigest(signed));
  });

  it('hashes anything that is not a thin 64-bit Mach-O whole, and refuses a truncated one', () => {
    expect(signatureFreeDigest(Buffer.from('#!/bin/sh\n'))).toBe(sha('#!/bin/sh\n'));
    expect(() => signatureFreeDigest(signed.subarray(0, 60))).toThrow(/load command/);
  });
});

describe('PINNED_FFMPEG_BUILD', { timeout: 300_000 }, () => {
  it('is the committed tools/ffmpeg/dist/BUILDINFO.json', () => {
    expect(PINNED_FFMPEG_BUILD).toBe(MAC.pinned);
    expect(PINNED_FFMPEG_BUILD.buildInfo).toBe(sha(readFileSync(join(DIST, 'BUILDINFO.json'))));
  });

  it.skipIf(!BUILT)('is the binaries in tools/ffmpeg/dist (pinBuild prints new values)', async () => {
    expect(await pinBuild(DIST)).toEqual(PINNED_FFMPEG_BUILD);
  });

  it.skipIf(!BUILT || process.platform !== 'darwin')(
    'accepts the build re-signed the way packaging signs it, and runs it',
    async () => {
      const sidecar = mkdtempSync(join(tmpdir(), 'taalcut-pinned-sidecar-'));
      scratch.push(sidecar);
      mkdirSync(join(sidecar, 'lib'));
      for (const name of [
        'ffmpeg',
        'ffprobe',
        'BUILDINFO.json',
        'lib/libMoltenVK.dylib',
        'lib/MoltenVK_icd.json',
      ]) {
        copyFileSync(join(DIST, name), join(sidecar, name));
      }
      for (const name of ['lib/libMoltenVK.dylib', 'ffmpeg', 'ffprobe']) {
        const file = join(sidecar, name);
        const before = await signatureFreeSha256(file);
        // packaging/signing.ts codesignArgs, ad-hoc: a new signature, new bytes.
        execFileSync('codesign', ['--force', '--sign', '-', '--options', 'runtime', file], {
          stdio: 'ignore',
        });
        expect(sha(readFileSync(file))).not.toBe(sha(readFileSync(join(DIST, name))));
        expect(await signatureFreeSha256(file)).toBe(before);
      }
      const result = await createBinaryResolver({
        env: {},
        sidecarDir: sidecar,
        requireLgpl: true,
      }).resolve();
      expect(result.ok && result.value).toMatchObject({ source: 'sidecar', verified: true });
    },
  );
});

describe('the linux-x64 pin', { timeout: 300_000 }, () => {
  const dir = join(DISTS, LINUX.devFolder);

  it('is the committed tools/ffmpeg/dist/linux-x64/BUILDINFO.json, for every file the target lists', () => {
    expect(LINUX.pinned.buildInfo).toBe(sha(readFileSync(join(dir, 'BUILDINFO.json'))));
    const info = JSON.parse(readFileSync(join(dir, 'BUILDINFO.json'), 'utf8')) as {
      ffmpeg_version: string;
      license: string;
      outputs: { name: string; path: string }[];
    };
    expect(info.ffmpeg_version).toBe(LINUX.version);
    expect(info.license).toBe('LGPL-2.1-or-later');
    expect(info.outputs.map((output) => [output.name, output.path])).toEqual(bundleFiles(LINUX, false));
    expect(Object.keys(LINUX.pinned.outputs).sort()).toEqual(info.outputs.map((output) => output.name).sort());
    expect(LINUX.vulkan).toBeUndefined();
  });

  it.skipIf(!LINUX_BUILT)('is the files in tools/ffmpeg/dist/linux-x64 (pinBuild prints new values)', async () => {
    expect(await pinBuild(dir, false, LINUX)).toEqual(LINUX.pinned);
  });

  it.skipIf(!LINUX_BUILT || process.platform !== 'linux')(
    'accepts a copy laid out as a sidecar, and runs it',
    async () => {
      const sidecar = mkdtempSync(join(tmpdir(), 'taalcut-pinned-linux-'));
      scratch.push(sidecar);
      mkdirSync(join(sidecar, 'bin'));
      mkdirSync(join(sidecar, 'lib'));
      for (const [, path] of [...bundleFiles(LINUX, false), ['', 'BUILDINFO.json'] as const]) {
        copyFileSync(join(dir, path), join(sidecar, path));
      }
      const result = await createBinaryResolver({ env: {}, sidecarDir: sidecar, requireLgpl: true, target: LINUX }).resolve();
      expect(result.ok && result.value).toMatchObject({ source: 'sidecar', verified: true, ffmpeg: join(sidecar, 'bin', 'ffmpeg') });
      expect(result.ok && 'vulkanIcd' in result.value).toBe(false);
    },
  );
});
