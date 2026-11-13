// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The utility processes' mac helper lookup (src/utility/roots/mac-helper-resolver.ts): in a packaged layout the
 * helper in Resources/bin runs only while it has the pin packaging baked in; a checkout's helper is unpinned.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SidecarPinMismatch, signatureFreeSha256 } from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { macHelperResolver } from '../src/utility/roots/mac-helper-resolver';

let scratch: string;
let resourcesPath: string;
let helper: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'taalcut-helper-resolver-'));
  resourcesPath = join(scratch, 'Taalcut.app', 'Contents', 'Resources');
  helper = join(resourcesPath, 'bin', 'taalcut-mac-helper');
  mkdirSync(join(resourcesPath, 'bin'), { recursive: true });
  writeFileSync(helper, 'the helper packaging pinned');
  chmodSync(helper, 0o755);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

describe('macHelperResolver', () => {
  it("runs a packaged app's helper while it has the baked pin, and refuses a swapped one", async () => {
    const pin = await signatureFreeSha256(helper);
    const packaged = { packaged: true, resourcesPath };
    const shipped = await macHelperResolver(packaged, pin).resolve();
    expect(shipped.ok && shipped.value).toEqual({ path: helper, source: 'sidecar' });
    writeFileSync(helper, 'a helper put there after packaging');
    const swapped = await macHelperResolver(packaged, pin).resolve();
    expect(swapped.ok).toBe(false);
    if (!swapped.ok) {
      expect(SidecarPinMismatch.is(swapped.error)).toBe(true);
      expect(swapped.error.detail).toBe(`${helper}: ${await signatureFreeSha256(helper)}`);
    }
  });

  it('runs no packaged helper from a bundle built without a pin', async () => {
    // vitest.config.ts bakes __TAALCUT_MAC_HELPER_PIN__ as '': a bundle built while dist had no helper.
    const unpinned = await macHelperResolver({ packaged: true, resourcesPath }).resolve();
    expect(unpinned.ok).toBe(false);
    if (!unpinned.ok) {
      expect(SidecarPinMismatch.is(unpinned.error)).toBe(true);
      expect(unpinned.error.detail).toBe(`${helper}: no pin to check it against, so it is not run`);
    }
  });

  it("leaves a checkout's helper unpinned, whatever the bundle's pin", async () => {
    vi.stubEnv('TAALCUT_MAC_HELPER', helper);
    const development = await macHelperResolver(
      { packaged: false, resourcesPath: '' },
      'ff'.repeat(32),
    ).resolve();
    expect(development.ok && development.value).toEqual({ path: helper, source: 'env' });
  });
});
