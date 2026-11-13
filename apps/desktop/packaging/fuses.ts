// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Electron fuses (PRD 6.4), flipped by electron-builder in the packaged
 * binary just before signing. One source of truth: the builder config uses
 * FUSES, and the packaged-app test reads the binary back against
 * EXPECTED_FUSE_WIRE.
 */
import { FuseV1Options } from '@electron/fuses';
import type { Configuration } from 'electron-builder';

type BuilderFuses = NonNullable<Configuration['electronFuses']>;

export const FUSES = {
  /** ELECTRON_RUN_AS_NODE would turn the signed app into a general-purpose Node. */
  runAsNode: false,
  /** Cookies on disk are encrypted with a key in the macOS keychain. */
  enableCookieEncryption: true,
  /** NODE_OPTIONS could inject code (--require) into main. */
  enableNodeOptionsEnvironmentVariable: false,
  /** --inspect and friends would open a debugger on main. */
  enableNodeCliInspectArguments: false,
  /** app.asar is checked against the hash in Info.plist (sealed by the code signature). */
  enableEmbeddedAsarIntegrityValidation: true,
  /** Only app.asar is loaded, never a loose app/ folder next to it. */
  onlyLoadAppFromAsar: true,
  /** No custom V8 snapshot is shipped, so don't look for one. */
  loadBrowserProcessSpecificV8Snapshot: false,
  /** file:// gets no more privilege than any other web origin. The app uses app://. */
  grantFileProtocolExtraPrivileges: false,
} as const satisfies BuilderFuses;

/**
 * Expected value of every fuse in Electron 44's wire, by index. WasmTrapHandlers
 * isn't exposed by electron-builder and keeps Electron's default (on: V8 uses
 * guard pages for WebAssembly bounds checks).
 */
export const EXPECTED_FUSE_WIRE: Readonly<Record<FuseV1Options, boolean>> = {
  [FuseV1Options.RunAsNode]: FUSES.runAsNode,
  [FuseV1Options.EnableCookieEncryption]: FUSES.enableCookieEncryption,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FUSES.enableNodeOptionsEnvironmentVariable,
  [FuseV1Options.EnableNodeCliInspectArguments]: FUSES.enableNodeCliInspectArguments,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FUSES.enableEmbeddedAsarIntegrityValidation,
  [FuseV1Options.OnlyLoadAppFromAsar]: FUSES.onlyLoadAppFromAsar,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: FUSES.loadBrowserProcessSpecificV8Snapshot,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: FUSES.grantFileProtocolExtraPrivileges,
  [FuseV1Options.WasmTrapHandlers]: true,
};
