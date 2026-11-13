// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  createPowerState,
  toThermalState,
  type PowerMonitorPort,
  type PowerSnapshot,
} from '../src/main/power/power-state';

type Listener = (...args: unknown[]) => void;

class FakeMonitor implements PowerMonitorPort {
  readonly events = new EventEmitter();
  battery = false;
  thermal = 'unknown';
  isOnBatteryPower() {
    return this.battery;
  }
  getCurrentThermalState() {
    return this.thermal;
  }
  on(event: string, listener: (...args: never[]) => void) {
    return this.events.on(event, listener as Listener);
  }
  removeListener(event: string, listener: (...args: never[]) => void) {
    return this.events.removeListener(event, listener as Listener);
  }
  emit(event: string, ...args: unknown[]) {
    this.events.emit(event, ...args);
  }
  listenerCount(event: string) {
    return this.events.listenerCount(event);
  }
}

describe('createPowerState', () => {
  it('reads the current state, treating an unknown thermal state as nominal', () => {
    const monitor = new FakeMonitor();
    monitor.battery = true;
    expect(createPowerState(monitor).current()).toEqual({ onBattery: true, thermalState: 'nominal' });
  });

  it('reports battery and thermal changes, once each', () => {
    const monitor = new FakeMonitor();
    const power = createPowerState(monitor);
    const seen: PowerSnapshot[] = [];
    power.onChange((snapshot) => seen.push(snapshot));

    monitor.emit('on-battery');
    monitor.emit('on-battery');
    monitor.emit('thermal-state-change', { state: 'serious' });
    monitor.emit('thermal-state-change', { state: 'serious' });
    monitor.emit('on-ac');
    monitor.emit('thermal-state-change', { state: 'critical' });

    expect(seen).toEqual([
      { onBattery: true, thermalState: 'nominal' },
      { onBattery: true, thermalState: 'serious' },
      { onBattery: false, thermalState: 'serious' },
      { onBattery: false, thermalState: 'critical' },
    ]);
    expect(power.current()).toEqual({ onBattery: false, thermalState: 'critical' });
  });

  it('unsubscribes listeners and detaches from the monitor on dispose', () => {
    const monitor = new FakeMonitor();
    const power = createPowerState(monitor);
    const seen: PowerSnapshot[] = [];
    const off = power.onChange((snapshot) => seen.push(snapshot));
    off();
    monitor.emit('on-battery');
    expect(seen).toEqual([]);
    power.dispose();
    expect(monitor.listenerCount('on-ac') + monitor.listenerCount('thermal-state-change')).toBe(0);
  });
});

describe('toThermalState', () => {
  it.each([
    ['nominal', 'nominal'],
    ['fair', 'fair'],
    ['serious', 'serious'],
    ['critical', 'critical'],
    ['unknown', 'nominal'],
    ['', 'nominal'],
  ])('%s → %s', (input, output) => {
    expect(toThermalState(input)).toBe(output);
  });
});
