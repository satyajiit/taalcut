// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Thermal state for the job engine (P1-E1 throttles concurrency under thermal
 * pressure). PowerState is the interface the job engine takes by injection;
 * createPowerState adapts anything shaped like Electron's powerMonitor, so it
 * is unit-tested with a fake.
 *
 * Battery or charger is never read: nothing in Taalcut depends on it (the
 * owner, 2026-11-15).
 */

export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical';

export interface PowerSnapshot {
  readonly thermalState: ThermalState;
}

export interface PowerState {
  current(): PowerSnapshot;
  /** Called with the new snapshot whenever it changes. Returns an unsubscribe function. */
  onChange(listener: (snapshot: PowerSnapshot) => void): () => void;
}

/** The part of Electron's powerMonitor used here. Use it only after app ready. */
export interface PowerMonitorPort {
  getCurrentThermalState(): string;
  on(event: 'thermal-state-change', listener: (details: { state: string }) => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
}

const THERMAL_STATES: readonly string[] = ['nominal', 'fair', 'serious', 'critical'];

/**
 * Electron reports 'unknown' where the OS has no thermal state (and on macOS
 * before the first reading). Treat it as nominal, so work isn't throttled for
 * no reason.
 */
export function toThermalState(value: string): ThermalState {
  return THERMAL_STATES.includes(value) ? (value as ThermalState) : 'nominal';
}

export function createPowerState(monitor: PowerMonitorPort): PowerState & { dispose(): void } {
  let snapshot: PowerSnapshot = { thermalState: toThermalState(monitor.getCurrentThermalState()) };
  const listeners = new Set<(snapshot: PowerSnapshot) => void>();

  const onThermal = (details: { state: string }) => {
    const thermalState = toThermalState(details.state);
    if (thermalState === snapshot.thermalState) return;
    snapshot = { thermalState };
    for (const listener of listeners) listener(snapshot);
  };

  monitor.on('thermal-state-change', onThermal);

  return {
    current: () => snapshot,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
      monitor.removeListener('thermal-state-change', onThermal);
    },
  };
}
