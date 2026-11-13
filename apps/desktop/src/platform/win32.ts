// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Windows: a stub that compiles, so the port is new implementations, not a rewrite (plan/linux-round-1.md, "Later").
 * Nothing runs on Windows yet. The frame and menu are Linux's (one path for both); each slot marked "not yet" is a
 * safe stand-in, not the Windows design.
 */
import { createDeviceVolumeProbe } from '@taalcut/library';
import { hardwareSessionFolder } from '@taalcut/media';
import { createWindowsHardwareProbe } from '@taalcut/models';
import type { MicrophoneAccess } from '../main/voice/microphone';
import { MEDIA_CACHE_ROOTS } from './cache-roots';
import { noNativeHelper, PC_ABILITIES } from './common';
import { controlsOverlayFrame } from './frame';
import { unavailableMountedMediaPort } from './mounted-media';
import type { PlatformServices, SystemPreferencesPort } from './types';

/** Not yet: Windows reports its privacy setting but has no prompt an app can show (askForMediaAccess is macOS's). */
function windowsMicrophone(preferences: SystemPreferencesPort): MicrophoneAccess {
  const status = () => {
    const found = preferences.getMediaAccessStatus('microphone');
    return found === 'unknown' ? 'granted' : found;
  };
  return { status, ask: () => Promise.resolve(status() === 'granted') };
}

export const win32: PlatformServices = {
  name: 'win32',
  label: 'Windows',
  words: 'windows',
  abilities: PC_ABILITIES,
  window: controlsOverlayFrame,
  menu: { appMenu: false, keyboard: 'pc', quitWhenAllWindowsClosed: true },
  titleBarDoubleClick: () => null,
  microphone: windowsMicrophone,
  // DPAPI keeps safeStorage's key under the user's login.
  secretStore: { refusal: () => null },
  // Not yet: inside userData (cache-roots.ts).
  mediaCacheRoot: MEDIA_CACHE_ROOTS.win32,
  compileCache: () => undefined,
  electronSwitches: [],
  // Not yet: volume serial numbers; the device number stands in.
  volumeProbe: () => createDeviceVolumeProbe(),
  mountedMedia: unavailableMountedMediaPort,
  nativeHelper: () => noNativeHelper('Windows'),
  // Not run on real Windows hardware yet (packages/models/SPEC.md).
  hardwareProbe: (dataDir, env = process.env) => createWindowsHardwareProbe({ dataDir, env }),
  hardwareSessionDir: () => hardwareSessionFolder({ platform: 'win32' }),
  // A slot until the Windows port has a CUDA component: PATH, or AddDllDirectory in the process itself.
  loaderSearchPath: undefined,
  // Not yet: an AppContainer or Windows Sandbox backend.
  workspaceShell: null,
};
