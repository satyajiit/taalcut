// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * macOS: the platform Taalcut was built on. Everything here is what apps/desktop did before the seam (LNX1-SHL),
 * moved, not changed.
 */
import { createMacVolumeProbe } from '@taalcut/library';
import { hardwareSessionFolder } from '@taalcut/media';
import { createMacHardwareProbe } from '@taalcut/models';
import { e5rtStore, helperCompileCache } from '../main/compile-cache/e5rt-store';
import { macProbes } from '../main/compile-cache/mac-probes';
import { electronMicrophone } from '../main/voice/electron-microphone';
import { macHelperResolver } from '../utility/roots/mac-helper-resolver';
import { MEDIA_CACHE_ROOTS } from './cache-roots';
import { hiddenLightsFrame } from './frame';
import { createMacMountedMediaPort } from './mounted-media';
import type { PlatformServices } from './types';

export { macMediaCacheRoot } from './cache-roots';

export const darwin: PlatformServices = {
  name: 'darwin',
  label: 'macOS',
  words: 'mac',
  abilities: {
    cableImport: true,
    localNetworkPrivacy: true,
    selfUpdate: true,
    systemSettingsPanes: true,
    nativeSubjects: true,
    photosImport: true,
  },
  window: hiddenLightsFrame,
  menu: { appMenu: true, keyboard: 'mac', quitWhenAllWindowsClosed: false },
  // System Settings › Desktop & Dock, "Double-click a window's title bar to"; null when unset.
  titleBarDoubleClick: (preferences) =>
    preferences.getUserDefault('AppleActionOnDoubleClick', 'string') || null,
  // TCC: the system asks once, and System Settings › Privacy is the way back.
  microphone: (preferences) => electronMicrophone(preferences),
  // safeStorage's key is in the login keychain; there is no other backend to refuse.
  secretStore: { refusal: () => null },
  // ~/Library/Caches/Taalcut (cache-roots.ts).
  mediaCacheRoot: MEDIA_CACHE_ROOTS.darwin,
  // Core ML's on-device compiles of the mac helper's models (IX3-B6).
  compileCache: (home) => ({ store: e5rtStore(helperCompileCache(home)), probes: macProbes() }),
  electronSwitches: [],
  volumeProbe: () => createMacVolumeProbe(),
  mountedMedia: () => createMacMountedMediaPort(),
  nativeHelper: (location) => macHelperResolver(location),
  hardwareProbe: (dataDir, env = process.env) => createMacHardwareProbe({ dataDir, env }),
  hardwareSessionDir: () => hardwareSessionFolder({ platform: 'darwin' }),
  loaderSearchPath: undefined,
  workspaceShell: 'seatbelt',
};
