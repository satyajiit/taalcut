// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The mac helper (native/mac-helper) in a packaged app, and the pin it runs against. Swift 6.3.3 doesn't compile the
 * helper to the same bytes twice (native/mac-helper/SPEC.md), so no pin is committed: packaging makes it.
 *
 *   1. `pnpm package` (and scripts/package-e2e.mjs) runs native/mac-helper/build.sh first, which signs the helper
 *      with TAALCUT_MAC_IDENTITY (ad-hoc without it).
 *   2. The desktop build (tsdown.config.ts) takes the signature-free sha256 of dist/taalcut-mac-helper (macHelperPin)
 *      into the build settings: baked into the bundles as __TAALCUT_MAC_HELPER_PIN__, so it is code in app.asar under
 *      ASAR integrity, never a file beside the helper, and recorded in out/build-info.json for step 3.
 *   3. electron-builder copies that binary into Resources/bin (macHelperResources). afterPack signs it with the app's
 *      identity and the helper's own entitlements (sidecars.ts), then checkPackedMacHelper fails the build unless the
 *      bundles carry a pin and the packed helper has it: no package ships unpinned, without its helper, or with a
 *      helper rebuilt after the bundles were.
 *   4. At run time src/utility/roots/mac-helper-resolver.ts runs the packed helper only while it has that pin.
 *
 * The digest leaves out the code signature and the sizes signing rewrites (@taalcut/media signatureFreeDigest), so
 * step 3's re-signing keeps it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AfterPackContext, FileSet } from 'electron-builder';
import { signatureFreeDigest } from '@taalcut/media';
import { SIDECAR_DESTINATION } from './sidecars';

export const MAC_HELPER_BINARY = 'taalcut-mac-helper';
const MAC_HELPER = join('..', '..', 'native', 'mac-helper');
const BUILD_SCRIPT = 'native/mac-helper/build.sh';

/** native/mac-helper/dist, which build.sh writes. */
export function macHelperDist(projectDir: string): string {
  return join(projectDir, MAC_HELPER, 'dist');
}

/** The helper's own entitlements: photos-library, for ImageCaptureCore (native/mac-helper/SPEC.md). */
export function macHelperEntitlements(projectDir: string): string {
  return join(projectDir, MAC_HELPER, 'entitlements.plist');
}

/** The signature-free sha256 of the built helper, or undefined while the checkout has none. */
export function macHelperPin(projectDir: string): string | undefined {
  const binary = join(macHelperDist(projectDir), MAC_HELPER_BINARY);
  return existsSync(binary) ? signatureFreeDigest(readFileSync(binary)) : undefined;
}

/** extraResources entry: the helper alone into Resources/bin. checkPackedMacHelper fails a package without it. */
export function macHelperResources(projectDir: string): FileSet[] {
  return [{ from: macHelperDist(projectDir), to: SIDECAR_DESTINATION, filter: [MAC_HELPER_BINARY] }];
}

/** afterPack, once the sidecars are signed: the packed helper must be the one the bundles were pinned to. */
export function checkPackedMacHelper(context: AfterPackContext, pin: string | undefined): void {
  if (context.electronPlatformName !== 'darwin') return;
  if (!pin) {
    throw new Error(
      `The bundles in out/ carry no mac helper pin: they were built without native/mac-helper/dist/${MAC_HELPER_BINARY}. ` +
        `Run ${BUILD_SCRIPT}, then the desktop build (pnpm package does both).`,
    );
  }
  const app = `${context.packager.appInfo.productFilename}.app`;
  const packed = join(
    context.appOutDir,
    app,
    'Contents',
    'Resources',
    SIDECAR_DESTINATION,
    MAC_HELPER_BINARY,
  );
  if (!existsSync(packed)) {
    throw new Error(
      `${packed} is missing: a packaged app always ships the mac helper. Run ${BUILD_SCRIPT}, then the desktop build.`,
    );
  }
  const digest = signatureFreeDigest(readFileSync(packed));
  if (digest !== pin) {
    throw new Error(
      `The packed mac helper (${digest}) is not the one the bundles were pinned to (${pin}): ` +
        'native/mac-helper/dist changed after the desktop build. Run the desktop build again.',
    );
  }
}
