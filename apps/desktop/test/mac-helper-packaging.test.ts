// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Packaging makes the mac helper's pin (packaging/mac-helper.ts): the desktop build takes it from
 * native/mac-helper/dist, afterPack's re-signing keeps it, and afterPack fails a package whose bundles carry no pin
 * or whose packed helper is another build.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AfterPackContext } from 'electron-builder';
import { signatureFreeDigest } from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builderConfig } from '../packaging/builder-config';
import {
  checkPackedMacHelper,
  MAC_HELPER_BINARY,
  macHelperEntitlements,
  macHelperPin,
  macHelperResources,
} from '../packaging/mac-helper';
import { AD_HOC, codesignArgs } from '../packaging/signing';

const desktopDir = join(import.meta.dirname, '..');
let scratch: string;
/** A checkout's apps/desktop: native/mac-helper/dist is two levels up. */
let desktop: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'taalcut-mac-helper-'));
  desktop = join(scratch, 'apps', 'desktop');
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

/** A minimal thin arm64 Mach-O: `body`, then a code signature that __LINKEDIT and LC_CODE_SIGNATURE size. */
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
  linkedit.writeBigUInt64LE(BigInt(body.length + signature.length), 32); // vmsize
  linkedit.writeBigUInt64LE(BigInt(body.length + signature.length), 48); // filesize
  const codeSignature = Buffer.alloc(16);
  codeSignature.writeUInt32LE(0x1d, 0);
  codeSignature.writeUInt32LE(16, 4);
  codeSignature.writeUInt32LE(32 + 72 + 16 + body.length, 8);
  codeSignature.writeUInt32LE(signature.length, 12);
  return Buffer.concat([header, linkedit, codeSignature, body, signature]);
}

const CODE = Buffer.from("the helper's code");
const BUILT = machO(CODE, Buffer.alloc(64, 1));
/** The same build after afterPack re-signed it: another signature, other sizes. */
const RESIGNED = machO(CODE, Buffer.alloc(9000, 7));
const PIN = signatureFreeDigest(BUILT);

function buildHelper(bytes: Buffer): string {
  const dist = join(scratch, 'native', 'mac-helper', 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, MAC_HELPER_BINARY), bytes);
  return join(dist, MAC_HELPER_BINARY);
}

/** An app as electron-builder hands it to afterPack, with `helper` packed into Resources/bin (or no bin/). */
function packedApp(helper?: Buffer, platform = 'darwin'): { context: AfterPackContext; packed: string } {
  const appOutDir = join(scratch, 'release', 'mac-arm64');
  const bin = join(appOutDir, 'Taalcut.app', 'Contents', 'Resources', 'bin');
  const packed = join(bin, MAC_HELPER_BINARY);
  mkdirSync(join(appOutDir, 'Taalcut.app', 'Contents', 'Resources', 'licences'), { recursive: true });
  if (helper) {
    mkdirSync(bin, { recursive: true });
    writeFileSync(packed, helper);
  }
  const context = {
    appOutDir,
    electronPlatformName: platform,
    packager: { appInfo: { productFilename: 'Taalcut' } },
  } as unknown as AfterPackContext;
  return { context, packed };
}

describe('macHelperPin, which the desktop build bakes in', () => {
  it("is the signature-free sha256 of native/mac-helper/dist's helper, and absent until one is built", () => {
    expect(macHelperPin(desktop)).toBeUndefined();
    buildHelper(BUILT);
    expect(macHelperPin(desktop)).toBe(PIN);
    expect(PIN).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stays when the helper is re-signed, and moves when the helper's code does", () => {
    buildHelper(RESIGNED);
    expect(macHelperPin(desktop)).toBe(PIN);
    buildHelper(machO(Buffer.from("the helper's code, rebuilt"), Buffer.alloc(64, 1)));
    expect(macHelperPin(desktop)).not.toBe(PIN);
  });

  it.skipIf(process.platform !== 'darwin')(
    "survives afterPack's codesign of a real binary, which keeps the helper's entitlements",
    () => {
      const built = buildHelper(Buffer.alloc(0));
      execFileSync('lipo', ['/usr/bin/true', '-thin', 'arm64e', '-output', built]);
      const pin = macHelperPin(desktop);
      const { context, packed } = packedApp(readFileSync(built));
      execFileSync('codesign', codesignArgs(AD_HOC, packed, macHelperEntitlements(desktopDir)), {
        stdio: 'ignore',
      });
      expect(readFileSync(packed).equals(readFileSync(built))).toBe(false);
      expect(() => checkPackedMacHelper(context, pin)).not.toThrow();
      const entitlements = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', packed], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      expect(entitlements).toContain('com.apple.security.personal-information.photos-library');
    },
  );
});

describe('checkPackedMacHelper (afterPack)', () => {
  it('passes the helper the bundles were pinned to, re-signed', () => {
    expect(() => checkPackedMacHelper(packedApp(RESIGNED).context, PIN)).not.toThrow();
  });

  it('fails a package whose bundles carry no pin', () => {
    expect(() => checkPackedMacHelper(packedApp(BUILT).context, undefined)).toThrow(
      /carry no mac helper pin.*Run native\/mac-helper\/build\.sh, then the desktop build/,
    );
  });

  it('fails a package without the helper', () => {
    const { context, packed } = packedApp();
    expect(() => checkPackedMacHelper(context, PIN)).toThrow(
      `${packed} is missing: a packaged app always ships the mac helper`,
    );
  });

  it('fails a helper that is not the pinned build', () => {
    const other = machO(Buffer.from('another build'), Buffer.alloc(64, 1));
    expect(() => checkPackedMacHelper(packedApp(other).context, PIN)).toThrow(
      `The packed mac helper (${signatureFreeDigest(other)}) is not the one the bundles were pinned to (${PIN})`,
    );
  });

  it('leaves a build for another platform alone', () => {
    expect(() => checkPackedMacHelper(packedApp(undefined, 'linux').context, undefined)).not.toThrow();
  });
});

describe('builderConfig', () => {
  const release = {
    flavour: 'release',
    updateFeedUrl: undefined,
    updateChannel: undefined,
    crashDsn: undefined,
    telemetryUrl: undefined,
  } as const;

  it('packs the helper alone into Resources/bin, and afterPack refuses the package without a pin', async () => {
    const config = builderConfig({}, desktop, release);
    expect(macHelperResources(desktop)).toEqual([
      { from: join(scratch, 'native', 'mac-helper', 'dist'), to: 'bin', filter: [MAC_HELPER_BINARY] },
    ]);
    expect(config.mac?.extraResources).toContainEqual(macHelperResources(desktop)[0]);
    const afterPack = config.afterPack;
    if (typeof afterPack !== 'function') throw new Error('afterPack is not a hook');
    await expect(afterPack(packedApp().context)).rejects.toThrow(/carry no mac helper pin/);
    const pinned = builderConfig({}, desktop, { ...release, macHelperPin: PIN }).afterPack;
    if (typeof pinned !== 'function') throw new Error('afterPack is not a hook');
    await expect(pinned(packedApp().context)).rejects.toThrow(/always ships the mac helper/);
  });
});
