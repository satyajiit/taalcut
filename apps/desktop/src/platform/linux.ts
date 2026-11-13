// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Linux (Ubuntu 22.04 and 24.04 this round; LNX1-SHL). What differs from macOS, slot by slot:
 *
 * - window: the title bar hidden, with the system's controls overlaid on the bar (frame.ts); no app menu, the
 *   menu bar hidden, and closing the last window quits.
 * - microphone: no OS-level permission, so granted (the app's own gate still applies).
 * - secret store: safeStorage falls back to a fixed key in the clear when the session's keyring gives it none
 *   (none on the bus, or locked with nothing to ask for the password), and the asynchronous encryptor the vault
 *   uses still says available; the vault refuses unless the backend is a keyring and the synchronous encryptor,
 *   which only a keyring's key makes available, agrees.
 * - media cache: under $XDG_CACHE_HOME (~/.cache), as userData is under $XDG_CONFIG_HOME.
 * - compile cache: none (no Core ML).
 * - volumes: /proc/self/mountinfo and /dev/disk/by-uuid (library's createLinuxVolumeProbe).
 * - native helper: none; each caller takes its fallback, as it does on a Mac without the helper.
 * - Electron switches: --password-store=gnome-libsecret outside a desktop session (keyringSwitches). No GPU
 *   switch: measured on the RTX 4090 host (desktop SPEC, "Platform services"), Chromium blocklists only
 *   video_encode, which Taalcut never uses (exports encode with FFmpeg).
 */
import { createLinuxVolumeProbe } from '@taalcut/library';
import { hardwareSessionFolder } from '@taalcut/media';
import { createLinuxHardwareProbe } from '@taalcut/models';
import { grantedMicrophone } from '../main/voice/electron-microphone';
import { MEDIA_CACHE_ROOTS } from './cache-roots';
import { noNativeHelper, PC_ABILITIES } from './common';
import { controlsOverlayFrame } from './frame';
import { unavailableMountedMediaPort } from './mounted-media';
import type { ElectronSwitch, PlatformServices, SecretStorePolicy } from './types';

/** safeStorage backends whose key a system keyring keeps (Electron's getSelectedStorageBackend). */
export const KEYRING_BACKENDS: ReadonlySet<string> = new Set([
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6',
]);

const PASSWORD_STORE = 'password-store';

/**
 * The store the command line asks for: the last `--password-store=<value>`, as Chromium reads a repeated switch,
 * lower-cased as the flag guard compares it (security/switches.ts); undefined without one.
 */
export function askedPasswordStore(argv: readonly string[]): string | undefined {
  const prefix = `--${PASSWORD_STORE}=`;
  return argv
    .findLast((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length)
    .toLowerCase();
}

/**
 * Refuses 'basic_text' (a fixed key, in the clear in effect), 'unknown' and anything newer it doesn't know; and a
 * keyring backend whose keyring gave no key, where Chromium seals with the fixed key all the same (measured: no
 * Secret Service on the bus, or a locked keyring with no display to ask on, reports gnome_libsecret).
 *
 * One exception, Linux's counterpart of `--use-mock-keychain` on a Mac (LNX1-PKG): 'basic_text' that the command
 * line asked for by name, `--password-store=basic`. Only a test build or a checkout gets that far (a packaged
 * release build refuses the switch before ready), so an e2e's app keeps its secrets off the developer's keyring.
 * Chosen any other way (no desktop, no bus), 'basic_text' is still refused.
 */
export function keyringPolicyFor(argv: readonly string[]): SecretStorePolicy {
  const mockKeyring = askedPasswordStore(argv) === 'basic';
  return {
    refusal(safe) {
      let backend = 'unknown';
      let keyed = false;
      try {
        backend = safe.getSelectedStorageBackend?.() ?? 'unknown';
        keyed = KEYRING_BACKENDS.has(backend) && safe.isEncryptionAvailable?.() === true;
      } catch {
        // An Electron without the calls can't say which key it uses: refused, like 'unknown'.
      }
      if (backend === 'basic_text' && mockKeyring) return null;
      if (!KEYRING_BACKENDS.has(backend)) return `safeStorage backend ${backend}: no system keyring`;
      return keyed ? null : `safeStorage backend ${backend}: the keyring gave no key`;
    },
  };
}

/** The policy with nothing asked on the command line. */
export const keyringPolicy: SecretStorePolicy = keyringPolicyFor([]);

/**
 * Chromium picks safeStorage's backend from XDG_CURRENT_DESKTOP, and without one (an SSH login, a systemd unit, a
 * script) takes 'basic_text' even when the session bus has a keyring on it: the vault then refuses a keyring it
 * could use. So with a session bus and no desktop, ask for libsecret by name; where there is no keyring after all,
 * keyringPolicy still refuses. A --password-store on the command line wins (release builds refuse 'basic' first:
 * security/switches.ts).
 */
export function keyringSwitches(env: NodeJS.ProcessEnv, argv: readonly string[]): ElectronSwitch[] {
  if (env.XDG_CURRENT_DESKTOP?.trim() || !env.DBUS_SESSION_BUS_ADDRESS?.trim()) return [];
  const given = argv.includes(`--${PASSWORD_STORE}`) || askedPasswordStore(argv) !== undefined;
  return given ? [] : [{ name: PASSWORD_STORE, value: 'gnome-libsecret' }];
}

export { xdgMediaCacheRoot } from './cache-roots';

export const linux: PlatformServices = {
  name: 'linux',
  label: 'Linux',
  words: 'computer',
  abilities: PC_ABILITIES,
  window: controlsOverlayFrame,
  menu: { appMenu: false, keyboard: 'pc', quitWhenAllWindowsClosed: true },
  // GNOME keeps its setting in dconf, read only by spawning gsettings; the bar's default (maximise) is GNOME's.
  titleBarDoubleClick: () => null,
  microphone: () => grantedMicrophone,
  // The command line main started with (a mock keyring only when it asks for one by name).
  get secretStore() {
    return keyringPolicyFor(process.argv);
  },
  // $XDG_CACHE_HOME/Taalcut (cache-roots.ts).
  mediaCacheRoot: MEDIA_CACHE_ROOTS.linux,
  compileCache: () => undefined,
  // The environment main starts in (read once, before ready).
  get electronSwitches() {
    return keyringSwitches(process.env, process.argv);
  },
  volumeProbe: () => createLinuxVolumeProbe(),
  mountedMedia: unavailableMountedMediaPort,
  nativeHelper: () => noNativeHelper('Linux'),
  // Honours TAALCUT_FORCE_CPU and CUDA_VISIBLE_DEVICES from the environment it is given.
  hardwareProbe: (dataDir, env = process.env) => createLinuxHardwareProbe({ dataDir, env }),
  hardwareSessionDir: () => hardwareSessionFolder({ platform: 'linux' }),
  // cuda-runtime-13's libraries for onnxruntime-cuda, whisper-server-cuda and llama.cpp's CUDA build.
  loaderSearchPath: { variable: 'LD_LIBRARY_PATH', separator: ':' },
  // /usr/bin/bwrap from the bubblewrap package the .deb depends on.
  workspaceShell: 'bwrap',
};
