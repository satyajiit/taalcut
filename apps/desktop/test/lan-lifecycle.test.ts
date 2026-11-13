// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { createLanLifecycle, LAN_STOP_DELAY_MS } from '../src/main/transfer/lan-lifecycle';

interface Scheduled {
  readonly ms: number;
  readonly fn: () => void;
  readonly cancel: ReturnType<typeof vi.fn>;
}

function harness() {
  const handles: Scheduled[] = [];
  const start = vi.fn();
  const stop = vi.fn(async () => undefined);
  const now = vi.fn(() => 1_700_000_000_000);
  const schedule = (ms: number, fn: () => void) => {
    const cancel = vi.fn();
    handles.push({ ms, fn, cancel });
    return { cancel };
  };
  const life = createLanLifecycle({ start, stop, now, schedule });
  const fire = (index = handles.length - 1) => {
    const handle = handles[index];
    if (!handle || handle.cancel.mock.calls.length > 0) return;
    handle.fn();
  };
  return { handles, start, stop, life, fire };
}

describe('lan lifecycle', () => {
  it('calls start on every transfer call; the supervisor dedupes a running process', () => {
    const { life, start } = harness();
    life.onTransferCall();
    life.onTransferCall();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('schedules a stop 60s after the session stops, and firing it stops the process', () => {
    const { life, handles, stop, fire } = harness();
    life.onSession({ state: 'stopped' });
    expect(handles).toHaveLength(1);
    expect(handles[0]?.ms).toBe(LAN_STOP_DELAY_MS);
    expect(LAN_STOP_DELAY_MS).toBe(60_000);
    fire();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('a new listening session cancels the pending stop', () => {
    const { life, handles, stop, fire } = harness();
    life.onSession({ state: 'stopped' });
    life.onSession({ state: 'listening' });
    expect(handles[0]?.cancel).toHaveBeenCalledTimes(1);
    fire();
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not schedule while a file is checking, and does once it is imported', () => {
    const { life, handles, stop, fire } = harness();
    life.onFile({ id: 'file-1', state: 'checking' });
    life.onSession({ state: 'stopped' });
    expect(handles).toHaveLength(0);
    life.onFile({ id: 'file-1', state: 'imported' });
    expect(handles).toHaveLength(1);
    expect(handles[0]?.ms).toBe(60_000);
    fire();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('holds the process while a file is importing and releases it when the file fails', () => {
    const { life, handles, stop, fire } = harness();
    life.onFile({ id: 'file-1', state: 'importing' });
    life.onSession({ state: 'stopped' });
    expect(handles).toHaveLength(0);
    life.onFile({ id: 'file-1', state: 'failed' });
    expect(handles).toHaveLength(1);
    fire();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('arms only after the last checking or importing file leaves', () => {
    const { life, handles } = harness();
    life.onFile({ id: 'a', state: 'checking' });
    life.onFile({ id: 'b', state: 'importing' });
    life.onSession({ state: 'stopped' });
    expect(handles).toHaveLength(0);
    life.onFile({ id: 'a', state: 'imported' });
    expect(handles).toHaveLength(0);
    life.onFile({ id: 'b', state: 'failed' });
    expect(handles).toHaveLength(1);
    expect(handles[0]?.ms).toBe(60_000);
  });

  it('dispose cancels the pending stop and does not stop the process', () => {
    const { life, handles, stop, fire } = harness();
    life.onSession({ state: 'stopped' });
    life.dispose();
    expect(handles[0]?.cancel).toHaveBeenCalledTimes(1);
    fire();
    expect(stop).not.toHaveBeenCalled();
  });

  it('a transfer call cancels a pending stop', () => {
    const { life, handles, start, stop, fire } = harness();
    life.onSession({ state: 'stopped' });
    life.onTransferCall();
    expect(handles[0]?.cancel).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    fire();
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not throw when stop rejects', async () => {
    const { life, stop, fire } = harness();
    stop.mockRejectedValueOnce(new Error('down'));
    life.onSession({ state: 'stopped' });
    expect(() => fire()).not.toThrow();
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('a running device import keeps the process up after Wi-Fi stops, and leaving running arms 60s', () => {
    const { life, handles } = harness();
    life.onDeviceRun({ id: 'run-1', state: 'running' });
    life.onSession({ state: 'stopped' });
    expect(handles).toHaveLength(0);
    life.onDeviceRun({ id: 'run-1', state: 'succeeded' });
    expect(handles).toHaveLength(1);
    expect(handles[0]?.ms).toBe(60_000);
  });

  it('an open devices watch holds across an idle Wi-Fi session and arms 60s when it closes', () => {
    const { life, handles } = harness();
    life.onDevicesWatch(true);
    life.onSession({ state: 'stopped' });
    expect(handles).toHaveLength(0);
    life.onDevicesWatch(false);
    expect(handles).toHaveLength(1);
    expect(handles[0]?.ms).toBe(60_000);
  });

  it('arms when a run leaves running after a transfer call cleared the idle stop', () => {
    const { life, handles } = harness();
    life.onSession({ state: 'stopped' });
    life.onTransferCall();
    expect(handles[0]?.cancel).toHaveBeenCalledTimes(1);
    life.onDeviceRun({ id: 'run-1', state: 'running' });
    expect(handles).toHaveLength(1);
    life.onDeviceRun({ id: 'run-1', state: 'paused' });
    expect(handles).toHaveLength(2);
    expect(handles[1]?.ms).toBe(60_000);
  });

  it('a paused run that was never running does not arm a stop', () => {
    const { life, handles } = harness();
    life.onSession({ state: 'stopped' });
    life.onTransferCall();
    life.onDeviceRun({ id: 'run-1', state: 'paused' });
    life.onDevicesWatch(false);
    expect(handles).toHaveLength(1);
    expect(handles[0]?.cancel).toHaveBeenCalledTimes(1);
  });

  it('does not arm when USB lets go while Wi-Fi is live', () => {
    const { life, handles } = harness();
    life.onSession({ state: 'listening' });
    life.onDeviceRun({ id: 'run-1', state: 'running' });
    life.onDeviceRun({ id: 'run-1', state: 'succeeded' });
    life.onDevicesWatch(true);
    life.onDevicesWatch(false);
    expect(handles).toHaveLength(0);
  });
});
