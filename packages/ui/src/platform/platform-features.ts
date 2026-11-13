// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the app can do where it runs, as the UI needs to know it (UX3-MAC). Wording that only names the machine is
 * platform-words.ts; this is for what differs in kind: a way in, a system switch, a fix that opens part of the OS.
 * Decided here by the platform, in one place, so a port that brings one of them over changes a row, not a screen.
 */
import type { FixAction, UiCommandName } from '@taalcut/core';
import { useHostPlatform, type HostPlatform } from './host-platform';

export interface PlatformFeatures {
  /**
   * A phone's clips over a USB cable (transfer's adb, MTP and Image Capture bridges). A Mac's for now: elsewhere the
   * desktop builds no bridge, and the screens say so and offer Wi-Fi.
   */
  readonly cableImport: boolean;
  /** macOS's Local Network switch for Taalcut, which only its own check of the Wi-Fi way needs. */
  readonly localNetworkPrivacy: boolean;
  /** Fixes that open a pane of System Settings (core's SYSTEM_SETTINGS_PANES: Files and Folders, Storage). */
  readonly systemSettingsPanes: boolean;
}

const MAC: PlatformFeatures = { cableImport: true, localNetworkPrivacy: true, systemSettingsPanes: true };
const OTHER: PlatformFeatures = {
  cableImport: false,
  localNetworkPrivacy: false,
  systemSettingsPanes: false,
};
const FEATURES: Readonly<Record<HostPlatform, PlatformFeatures>> = { mac: MAC, linux: OTHER, windows: OTHER };

export function platformFeatures(platform: HostPlatform): PlatformFeatures {
  return FEATURES[platform];
}

/** platformFeatures of the platform the app provides (HostPlatformProvider). */
export function usePlatformFeatures(): PlatformFeatures {
  return platformFeatures(useHostPlatform());
}

/** The UI commands whose fix opens a pane of System Settings (use-ui-actions.ts). */
const SYSTEM_SETTINGS_FIXES: ReadonlySet<string> = new Set<UiCommandName>([
  'system.openFilesAndFolders',
  'system.openStorage',
]);

/** Fixes an error stored by an older build can still name, whose command now does nothing (REF1). */
const RETIRED_FIXES: ReadonlySet<string> = new Set<UiCommandName>(['reference.showWarning']);

/**
 * The fix an error offers on `platform`: none where it would open a part of the system that isn't there (System
 * Settings off a Mac), and none for a retired fix. The error's sentence still says what to do.
 */
export function fixOn(fix: FixAction | undefined, platform: HostPlatform): FixAction | undefined {
  if (!fix || RETIRED_FIXES.has(fix.command)) return undefined;
  if (SYSTEM_SETTINGS_FIXES.has(fix.command) && !platformFeatures(platform).systemSettingsPanes)
    return undefined;
  return fix;
}
