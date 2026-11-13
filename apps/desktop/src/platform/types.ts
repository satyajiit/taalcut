// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Seam 2 of the Linux round (plan/linux-round-1.md): everything in apps/desktop that differs by OS, behind one
 * interface. darwin.ts, linux.ts and win32.ts implement it; index.ts picks one once per process, and it is
 * injected from there (main's composition root, each utility process's container). No other file in
 * apps/desktop/src reads process.platform (test/platform-branches.test.ts).
 *
 * Electron-free: what a slot needs of Electron (a window, systemPreferences, safeStorage) is a port the caller
 * passes in, so the slots are unit-tested and utility processes can load this module too.
 */
import { createToken, type Keyboard } from '@taalcut/core';
import type { VolumeProbe } from '@taalcut/library';
import type { SidecarResolver } from '@taalcut/media';
import type { HardwareProbe, ProbeEnv } from '@taalcut/models';
import type { CompileStore } from '../main/compile-cache/e5rt-store';
import type { SweepProbes } from '../main/compile-cache/mac-probes';
import type { MicrophoneAccess } from '../main/voice/microphone';
import type { PlatformName } from './names';
import type { MountedMediaPort } from './mounted-media';

export { PLATFORM_NAMES, type PlatformName } from './names';

/** The theme's colours for the parts of the frame the system draws (the controls overlay). */
export interface ChromeColours {
  /** The bar's background: the canvas colour. */
  readonly background: string;
  /** The system controls' glyphs: ink-2. */
  readonly symbols: string;
}

/** The BrowserWindow options the platform decides; a subset of Electron's, merged into the main window's. */
export interface ChromeOptions {
  readonly titleBarStyle?: 'hidden';
  readonly titleBarOverlay?: {
    readonly color: string;
    readonly symbolColor: string;
    readonly height: number;
  };
  readonly autoHideMenuBar?: boolean;
}

/** The parts of a BrowserWindow the chrome touches (each exists on every OS in Electron's API). */
export interface ChromeWindow {
  setWindowButtonVisibility(visible: boolean): void;
  setMenuBarVisibility(visible: boolean): void;
  setTitleBarOverlay(options: { color?: string; symbolColor?: string; height?: number }): void;
  on(event: 'enter-full-screen' | 'leave-full-screen', listener: () => void): unknown;
}

/** The main window's frame (window.ts): the renderer draws the bar, the platform keeps what it must. */
export interface WindowChrome {
  options(colours: ChromeColours): ChromeOptions;
  /** Once, after the window is made. */
  attach(win: ChromeWindow): void;
  /** The theme changed: what the system draws follows it. */
  recolour(win: ChromeWindow, colours: ChromeColours): void;
}

/** The application menu's shape (app-menu.ts) and what closing the last window does. */
export interface MenuPolicy {
  /**
   * macOS's menu under the app's name (About, Settings…, Services, Hide, Quit) and the Window menu's Zoom and
   * Bring All to Front. Elsewhere Settings… and Quit are under File, and the menu bar stays hidden: the menu is
   * there for its accelerators and roles (undo, copy, zoom, full screen).
   */
  readonly appMenu: boolean;
  /**
   * Whose keyboard the menu's accelerators are for (core's shortcutOn): a Mac's, or a PC's, where a binding that
   * would clash is replaced (View › Toggle Sidebar is Ctrl+B, not Ctrl+S).
   */
  readonly keyboard: Keyboard;
  /** Closing the last window quits (Linux, Windows) or leaves the app running until ⌘Q (macOS). */
  readonly quitWhenAllWindowsClosed: boolean;
}

/** The parts of Electron's systemPreferences the slots read. */
export interface SystemPreferencesPort {
  getUserDefault(key: string, type: 'string'): string;
  getMediaAccessStatus(
    mediaType: 'microphone',
  ): 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
  askForMediaAccess(mediaType: 'microphone'): Promise<boolean>;
}

/** The part of Electron's safeStorage the policy reads. `getSelectedStorageBackend` exists on Linux only. */
export interface StorageBackendPort {
  getSelectedStorageBackend?(): string;
  /**
   * The synchronous encryptor's availability. On Linux it is true only when the selected keyring gave Chromium its
   * key, while the asynchronous one says available with the fixed key too (desktop SPEC, "Platform services").
   */
  isEncryptionAvailable?(): boolean;
}

/** Whether safeStorage's key is kept where the vault may trust it (composition/secret-store.ts). */
export interface SecretStorePolicy {
  /** null when the key is in a system keyring; otherwise why not, for the developer detail. Never a secret. */
  refusal(safe: StorageBackendPort): string | null;
}

/** A Chromium switch main appends before ready. */
export interface ElectronSwitch {
  readonly name: string;
  readonly value?: string;
}

/** The compile cache main sweeps at start (compile-cache/sweep.ts): where it is, and how to tell what is in use. */
export interface PlatformCompileCache {
  readonly store: CompileStore;
  readonly probes: SweepProbes;
}

/** Where a native helper ships: a packaged app's Resources, or a checkout. */
export interface HelperLocation {
  readonly packaged: boolean;
  readonly resourcesPath: string;
}

/**
 * Whose words a sentence uses for this machine (UX3-MAC): a Mac's ("this Mac"), any other computer's ("this
 * computer"), or Windows' where it has its own ("File Explorer"). The window's HostPlatform says the same.
 */
export type MachineWords = 'mac' | 'computer' | 'windows';

/**
 * What Taalcut can do here that differs in kind, not wording (UX3-MAC). The window reads the same from its
 * platform (packages/ui platform-features.ts); these are the processes' side of each.
 */
export interface PlatformAbilities {
  /**
   * A phone's clips over a USB cable: transfer's adb, MTP and Image Capture bridges are built only where true.
   * Elsewhere the lan process answers that a cable isn't here yet, and the window offers Wi-Fi.
   */
  readonly cableImport: boolean;
  /**
   * An OS switch that stops Taalcut reaching the local network (macOS's Local Network privacy). Only where true does
   * the Wi-Fi way's self-check read a refused connection to itself as that switch; elsewhere it is a firewall.
   */
  readonly localNetworkPrivacy: boolean;
  /** Updates install themselves (Squirrel.Mac and the latest-mac.yml feed); elsewhere the updater never starts. */
  readonly selfUpdate: boolean;
  /** System Settings panes main may open (core's SYSTEM_SETTINGS_PANES); elsewhere system.openSystemSettings refuses. */
  readonly systemSettingsPanes: boolean;
  /**
   * Subject tracks on the native helper's Apple Vision (FRM1-SUB); elsewhere `render.trackSubjects` runs vision's
   * ONNX detector, and the tracks key apart by their recipe.
   */
  readonly nativeSubjects: boolean;
  /** Read/export from the System Photo Library through the native PhotoKit helper. */
  readonly photosImport: boolean;
}

export interface PlatformServices {
  readonly name: PlatformName;
  /** How the OS names itself where a sentence needs it (a log line, a refusal's detail). */
  readonly label: string;
  /** Whose words main's sentences and the phone page use for this machine. */
  readonly words: MachineWords;
  readonly abilities: PlatformAbilities;
  readonly window: WindowChrome;
  readonly menu: MenuPolicy;
  /** The title-bar double-click setting the window bar follows (core's doubleClickAction); null when none. */
  titleBarDoubleClick(preferences: SystemPreferencesPort): string | null;
  microphone(preferences: SystemPreferencesPort): MicrophoneAccess;
  readonly secretStore: SecretStorePolicy;
  /** Where derived media lives for this userData (shared/media-cache.ts). */
  mediaCacheRoot(userData: string): string;
  /** The on-device compile cache main sweeps at start; undefined when the OS keeps none. */
  compileCache(home: string): PlatformCompileCache | undefined;
  /**
   * Measured per OS (SPEC.md, "Platform services"): a switch only where Chromium's own choice is wrong here (a GPU
   * feature it blocklists, a keyring it doesn't look for). Read once, before ready.
   */
  readonly electronSwitches: readonly ElectronSwitch[];
  /** Mounted volumes and their identities, for library locations on other drives. */
  volumeProbe(): VolumeProbe;
  /** Discover external camera/card storage and ask the OS to eject it. */
  mountedMedia(): MountedMediaPort;
  /** The native helper (OCR, Parakeet, reframe, grade, device thumbnails); one that is never found off a Mac. */
  nativeHelper(location: HelperLocation): SidecarResolver;
  /** This OS's HardwareProbe (@taalcut/models); free disk is measured on dataDir's volume. */
  hardwareProbe(dataDir: string, env?: ProbeEnv): HardwareProbe;
  /** Where processes share hardware video session tokens (media's hardwareSessionFolder for this OS). */
  hardwareSessionDir(): string;
  /**
   * How this OS's loader is told about more library folders, for the GPU runtimes' shared libraries
   * (utility/accelerator-env.ts). undefined where nothing is needed (macOS: Metal and Core ML are the system's).
   */
  readonly loaderSearchPath: LoaderSearchPath | undefined;
  /**
   * What confines the agent's workspace shell here (AGT2 sbx, utility/roots/workspace-shell.ts): Seatbelt's
   * workspace.sb, the distribution's bubblewrap (which also reads the app FFmpeg's whole folder, since Linux's FFmpeg
   * loads its libraries from ../lib), or null where there is none yet and the shell is `sandbox.unavailable`.
   */
  readonly workspaceShell: 'seatbelt' | 'bwrap' | null;
}

/** A loader search path variable and its separator, e.g. LD_LIBRARY_PATH and ':'. */
export interface LoaderSearchPath {
  readonly variable: string;
  readonly separator: string;
}

export const PlatformServicesToken = createToken<PlatformServices>('desktop.platform');
