// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Battery and thermal state for the job engine (P1-E1 throttles concurrency
 * on battery and under thermal pressure). PowerState is the interface the job
 * engine takes by injection; createPowerState adapts anything shaped like
 * Electron's powerMonitor, so it is unit-tested with a fake.
 */

export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical';

export interface PowerSnapshot {
  readonly onBattery: boolean;
  readonly thermalState: ThermalState;
}

export interface PowerState {
  current(): PowerSnapshot;
  /** Called with the new snapshot whenever either value changes. Returns an unsubscribe function. */
  onChange(listener: (snapshot: PowerSnapshot) => void): () => void;
}

/** The part of Electron's powerMonitor used here. Use it only after app ready. */
export interface PowerMonitorPort {
  isOnBatteryPower(): boolean;
  getCurrentThermalState(): string;
  on(event: 'on-ac' | 'on-battery', listener: () => void): unknown;
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
  let snapshot: PowerSnapshot = {
    onBattery: monitor.isOnBatteryPower(),
    thermalState: toThermalState(monitor.getCurrentThermalState()),
  };
  const listeners = new Set<(snapshot: PowerSnapshot) => void>();

  const update = (next: Partial<PowerSnapshot>) => {
    const merged = { ...snapshot, ...next };
    if (merged.onBattery === snapshot.onBattery && merged.thermalState === snapshot.thermalState) return;
    snapshot = merged;
    for (const listener of listeners) listener(snapshot);
  };
  const onAc = () => update({ onBattery: false });
  const onBattery = () => update({ onBattery: true });
  const onThermal = (details: { state: string }) => update({ thermalState: toThermalState(details.state) });

  monitor.on('on-ac', onAc);
  monitor.on('on-battery', onBattery);
  monitor.on('thermal-state-change', onThermal);

  return {
    current: () => snapshot,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
      monitor.removeListener('on-ac', onAc);
      monitor.removeListener('on-battery', onBattery);
      monitor.removeListener('thermal-state-change', onThermal);
    },
  };
}
