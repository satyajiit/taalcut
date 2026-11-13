// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** PowerState over Electron's powerMonitor. Call after app ready (powerMonitor isn't usable before). */
import { powerMonitor } from 'electron';
import { createPowerState, type PowerState } from './power-state';

export function electronPowerState(): PowerState & { dispose(): void } {
  return createPowerState(powerMonitor);
}
