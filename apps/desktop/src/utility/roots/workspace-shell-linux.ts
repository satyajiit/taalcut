// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 sbx on Linux: the workspace shell under the distribution's bubblewrap (the .deb depends on it and loads the
 * AppArmor profile that lets /usr/bin/bwrap make a user namespace on Ubuntu 23.10 and later). Without a usable
 * bwrap the shell is `sandbox.unavailable`, and its detail says what to install (packages/tools bwrap-host.ts).
 */
import { bwrapBackendFor, type BackendFor } from '@taalcut/tools';

export function linuxShellBackend(): BackendFor {
  return bwrapBackendFor();
}
