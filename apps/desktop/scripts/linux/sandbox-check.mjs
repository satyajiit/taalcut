// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Before `pnpm dev` starts Electron on Linux: when the kernel restricts unprivileged user namespaces to programs
 * with an AppArmor profile (Ubuntu 23.10 and later) and the development profile isn't installed, Electron can't
 * start its sandbox and exits with a FATAL line about chrome-sandbox. Say what to run instead.
 */
import { existsSync, readFileSync } from 'node:fs';

export const RESTRICT_SYSCTL = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns';
export const DEV_PROFILE = '/etc/apparmor.d/taalcut-dev';
export const INSTALL_COMMAND = 'sudo apps/desktop/scripts/linux/install-apparmor-dev.sh';

/** The message to print, or null when Electron's sandbox can start. */
export function sandboxHint({
  platform = process.platform,
  read = (path) => readFileSync(path, 'utf8'),
  exists = existsSync,
} = {}) {
  if (platform !== 'linux') return null;
  let restricted;
  try {
    restricted = read(RESTRICT_SYSCTL).trim() === '1';
  } catch {
    return null; // No such sysctl: the kernel doesn't restrict user namespaces this way.
  }
  if (!restricted || exists(DEV_PROFILE)) return null;
  return [
    'This kernel lets only programs with an AppArmor profile use the sandbox Electron needs',
    `(kernel.apparmor_restrict_unprivileged_userns=1), and ${DEV_PROFILE} isn't installed.`,
    `Install the development profile once, from the repository root:\n\n  ${INSTALL_COMMAND}\n`,
  ].join('\n');
}
