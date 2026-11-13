// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Slot implementations more than one platform shares. */
import { err } from '@taalcut/core';
import { SidecarNotFound, type SidecarResolver } from '@taalcut/media';
import type { PlatformAbilities } from './types';

/**
 * Linux's and, for now, Windows': no cable bridges, no Local Network switch, no updates in place and no System
 * Settings (types.ts, PlatformAbilities).
 */
export const PC_ABILITIES: PlatformAbilities = {
  cableImport: false,
  localNetworkPrivacy: false,
  selfUpdate: false,
  systemSettingsPanes: false,
  nativeSubjects: false,
  photosImport: false,
};

/**
 * Off a Mac there is no native helper (native/mac-helper is Swift on Apple's frameworks). Every caller already
 * takes its fallback when the helper isn't found, as on a Mac whose checkout hasn't built it.
 */
export function noNativeHelper(os: string): SidecarResolver {
  return {
    resolve: async () =>
      err(SidecarNotFound({ binary: 'taalcut-mac-helper' }, { detail: `no native helper on ${os}` })),
  };
}
