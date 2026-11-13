// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a utility process finds the mac helper (native/mac-helper): in a packaged app the signed binary in
 * Resources/bin, run only while its signature-free sha256 is the pin packaging baked into this bundle
 * (`__TAALCUT_MAC_HELPER_PIN__`, packaging/mac-helper.ts; a bundle without one runs no packaged helper); in a
 * checkout, `TAALCUT_MAC_HELPER` or `native/mac-helper/dist`, unpinned. The one lookup for every root that starts the
 * helper: vision's OCR, Parakeet, render's reframe and grade, the template sandbox and LAN devices' thumbnails.
 */
import { join } from 'node:path';
import { createSidecarResolver, type SidecarResolver } from '@taalcut/media';
import type { UtilityConfig } from '../../shared/rpc-ipc';

export function macHelperResolver(
  config: Pick<UtilityConfig, 'packaged' | 'resourcesPath'>,
  pin: string = __TAALCUT_MAC_HELPER_PIN__,
): SidecarResolver {
  const name = 'taalcut-mac-helper';
  return createSidecarResolver(
    config.packaged
      ? { name, sidecarDir: join(config.resourcesPath, 'bin'), pin, env: {} }
      : { name, development: true, pin: '', env: process.env },
  );
}
