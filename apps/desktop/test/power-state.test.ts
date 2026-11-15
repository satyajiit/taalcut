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
  thermal = 'unknown';
  /** Electron's powerMonitor has it; Taalcut must never ask (the owner, 2026-11-15). */
  isOnBatteryPower(): boolean {
    throw new Error('battery state was read');
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
    expect(createPowerState(monitor).current()).toEqual({ thermalState: 'nominal' });
  });

  it('never reads or follows battery or charger: plugging in or out changes nothing', () => {
    const monitor = new FakeMonitor();
    const power = createPowerState(monitor);
    const seen: PowerSnapshot[] = [];
    power.onChange((snapshot) => seen.push(snapshot));
    expect(monitor.listenerCount('on-battery') + monitor.listenerCount('on-ac')).toBe(0);
    monitor.emit('on-battery');
    monitor.emit('on-ac');
    expect(seen).toEqual([]);
    expect(power.current()).toEqual({ thermalState: 'nominal' });
  });

  it('reports thermal changes, once each', () => {
    const monitor = new FakeMonitor();
    const power = createPowerState(monitor);
    const seen: PowerSnapshot[] = [];
    power.onChange((snapshot) => seen.push(snapshot));

    monitor.emit('thermal-state-change', { state: 'serious' });
    monitor.emit('thermal-state-change', { state: 'serious' });
    monitor.emit('thermal-state-change', { state: 'critical' });

    expect(seen).toEqual([{ thermalState: 'serious' }, { thermalState: 'critical' }]);
    expect(power.current()).toEqual({ thermalState: 'critical' });
  });

  it('unsubscribes listeners and detaches from the monitor on dispose', () => {
    const monitor = new FakeMonitor();
    const power = createPowerState(monitor);
    const seen: PowerSnapshot[] = [];
    const off = power.onChange((snapshot) => seen.push(snapshot));
    off();
    monitor.emit('thermal-state-change', { state: 'serious' });
    expect(seen).toEqual([]);
    power.dispose();
    expect(monitor.listenerCount('thermal-state-change')).toBe(0);
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
