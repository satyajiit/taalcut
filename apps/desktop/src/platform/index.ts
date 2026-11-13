// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The platform services for the OS this process runs on (types.ts), by names.ts's one read of process.platform:
 * main's entry and each utility process's container call it once and inject what it returns.
 */
import { darwin } from './darwin';
import { linux } from './linux';
import { win32 } from './win32';
import { hostPlatformName, type PlatformName } from './names';
import type { PlatformServices } from './types';

export {
  PlatformServicesToken,
  type MachineWords,
  type PlatformAbilities,
  type PlatformName,
  type PlatformServices,
} from './types';

const PLATFORMS: Readonly<Record<PlatformName, PlatformServices>> = { darwin, linux, win32 };

/** The services for `platform` (names.ts: another Unix gets Linux's). */
export function hostPlatform(platform?: string): PlatformServices {
  return PLATFORMS[hostPlatformName(platform)];
}
