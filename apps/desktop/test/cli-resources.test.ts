// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builderConfig } from '../packaging/builder-config';
import { TAALCUT_CLI_BINARY, taalcutCliDist, taalcutCliResources } from '../packaging/cli-resources';
import { SIDECAR_SIGN_IGNORE } from '../packaging/sidecars';

/** The first bytes of an arm64 Mach-O executable (MH_MAGIC_64, little-endian). */
const MACH_O = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);
let scratch: string;
let desktop: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'taalcut-cli-resources-'));
  desktop = join(scratch, 'apps', 'desktop');
  mkdirSync(desktop, { recursive: true });
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

function buildCli(): string {
  const dist = taalcutCliDist(desktop);
  mkdirSync(dist, { recursive: true });
  const binary = join(dist, TAALCUT_CLI_BINARY);
  writeFileSync(binary, MACH_O);
  chmodSync(binary, 0o755);
  writeFileSync(join(dist, 'BUILDINFO.json'), '{}');
  return dist;
}

describe('taalcutCliResources', () => {
  it('adds nothing until native/taalcut-cli/dist has the tool', () => {
    expect(taalcutCliDist(desktop)).toBe(join(scratch, 'native', 'taalcut-cli', 'dist'));
    expect(taalcutCliResources(desktop)).toEqual([]);
  });

  it('fails a build that ships updates (TAALCUT_REQUIRE_CLI=1) when the tool is missing', () => {
    expect(() => taalcutCliResources(desktop, { TAALCUT_REQUIRE_CLI: '1' })).toThrow(/taalcut-cli\/build\.sh/);
  });

  it('copies only the tool into Resources/bin, where afterPack signs every Mach-O', () => {
    const dist = buildCli();
    const entry = { from: dist, to: 'bin', filter: [TAALCUT_CLI_BINARY] };
    expect(taalcutCliResources(desktop, { TAALCUT_REQUIRE_CLI: '1' })).toEqual([entry]);
    const config = builderConfig({}, desktop, {
      flavour: 'release',
      updateFeedUrl: undefined,
      updateChannel: undefined,
      crashDsn: undefined,
      telemetryUrl: undefined,
    });
    expect(config.mac?.extraResources).toContainEqual(entry);
    // electron-builder's own signing skips bin/: the sidecar signer owns it.
    expect(config.mac?.signIgnore).toEqual([SIDECAR_SIGN_IGNORE]);
    expect(`/Taalcut.app/Contents/Resources/bin/${TAALCUT_CLI_BINARY}`).toMatch(new RegExp(SIDECAR_SIGN_IGNORE));
  });
});
