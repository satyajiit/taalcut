// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One DeviceView per phone. Watches USB while a devices() stream or a run is
 * active. Image Capture stays off until an Apple device is on the bus, or adb
 * and MTP have both failed to open a non-Apple phone.
 */
import {
  err,
  ok,
  toTaalcutError,
  type AsyncResult,
  type Clock,
  type DeviceView,
  type TaalcutError,
} from '@taalcut/core';
import type {
  BridgeDeviceRef,
  BridgeKind,
  BridgeSession,
  DeviceAccess,
  DeviceBridge,
  UsbDeviceInfo,
  UsbWatcher,
} from './bridge';
import { deviceKey } from './device-key';
import { DeviceGone } from './errors';
import { newRecord, usbIdentity, type LiveDevice } from './hub-record';
import { createOpenFlights, createSessionDropper, waitForBridgeRef } from './hub-sessions';
import { busyHolder, orderFromRefs, toDeviceView, type BusyHolder } from './hub-view';
import { defaultSchedule, type Schedule } from './schedule';
import { classify, hasAdb, hasStillImage, isAndroidVendor, isAppleDevice } from './usb-watch';

const BUSY_MS = 5_000;

export interface DeviceHubDeps {
  readonly bridges: readonly DeviceBridge[];
  readonly watcher: UsbWatcher;
  readonly clock: Clock;
  readonly schedule?: Schedule;
  readonly log?: { info(line: string): void };
}

export interface DeviceHub {
  retain(): void;
  release(): void;
  close(): Promise<void>;
  views(): DeviceView[];
  view(key: string): DeviceView | null;
  session(key: string): BridgeSession | null;
  /** Why USB watching stopped on its own (the addon didn't load, the watcher threw); null while it runs. */
  failure(): TaalcutError | null;
  listen(listener: () => void): () => void;
  onRemoved(listener: (deviceKey: string, locked: boolean) => void): () => void;
  onAccess(listener: (deviceKey: string, access: DeviceAccess) => void): () => void;
  open(key: string, signal: AbortSignal): AsyncResult<DeviceView>;
}

export function createDeviceHub(deps: DeviceHubDeps): DeviceHub {
  const schedule = deps.schedule ?? defaultSchedule;
  const byKind = new Map<BridgeKind, DeviceBridge>(deps.bridges.map((bridge) => [bridge.kind, bridge]));
  const records = new Map<string, LiveDevice>();
  const listeners = new Set<() => void>();
  const removed = new Set<(deviceKey: string, locked: boolean) => void>();
  const access = new Set<(deviceKey: string, access: DeviceAccess) => void>();
  const started = new Map<BridgeKind, AbortController>();
  const sessions = createSessionDropper(deps.log);
  const flights = createOpenFlights();
  let interest = 0;
  let abort: AbortController | null = null;
  let icProbing = 0;
  let watchFailure: TaalcutError | null = null;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function retain(): void {
    interest += 1;
    if (interest === 1) start();
  }

  function release(): void {
    interest = Math.max(0, interest - 1);
    if (interest === 0) stop();
  }

  function start(): void {
    watchFailure = null;
    abort = new AbortController();
    const signal = abort.signal;
    void pumpUsb(signal);
    syncWatches();
  }

  /**
   * Nothing watches any more, so nothing would say a phone left: every record goes, and the
   * next retain rebuilds them from what is on the bus then (no ghost cards).
   */
  function stop(): void {
    flights.cancelAll();
    abort?.abort();
    abort = null;
    for (const controller of started.values()) controller.abort();
    started.clear();
    icProbing = 0;
    for (const rec of records.values()) {
      rec.timer?.cancel();
      rec.timer = null;
      dropSession(rec);
    }
    records.clear();
    emit();
  }

  async function pumpUsb(signal: AbortSignal): Promise<void> {
    try {
      for await (const event of deps.watcher.watch(signal)) {
        if (signal.aborted) return;
        if (event.type === 'added') addUsb(event.device);
        else removeUsb(event.device);
      }
    } catch (cause) {
      if (signal.aborted) return;
      watchFailure = toTaalcutError(cause);
      deps.log?.info(`usb watch failed ${watchFailure.code}`);
      emit();
    }
  }

  async function pumpBridge(bridge: DeviceBridge, controller: AbortController): Promise<void> {
    const { signal } = controller;
    try {
      for await (const event of bridge.watch(signal)) {
        if (signal.aborted) return;
        if (event.type === 'added') addRef(event.ref);
        else removeRef(event.ref);
      }
    } catch (cause) {
      if (!signal.aborted) deps.log?.info(`usb ${bridge.kind} watch failed ${toTaalcutError(cause).code}`);
    } finally {
      if (started.get(bridge.kind) === controller) started.delete(bridge.kind);
    }
  }

  function startKind(kind: BridgeKind): void {
    if (!abort || started.has(kind)) return;
    const bridge = byKind.get(kind);
    if (!bridge) return;
    const controller = new AbortController();
    started.set(kind, controller);
    void pumpBridge(bridge, controller);
  }

  function stopKind(kind: BridgeKind): void {
    const controller = started.get(kind);
    if (!controller) return;
    started.delete(kind);
    controller.abort();
    if (kind === 'image-capture') {
      for (const rec of records.values()) {
        if (rec.usb && isAppleDevice(rec.usb)) continue;
        if (rec.session?.ref.bridge === 'image-capture') continue;
        rec.refs.delete('image-capture');
      }
    }
  }

  function imageCaptureAllowed(): boolean {
    if (icProbing > 0) return true;
    for (const rec of records.values()) {
      if (rec.session?.ref.bridge === 'image-capture') return true;
      if (rec.usbPresent && rec.usb && isAppleDevice(rec.usb)) return true;
    }
    return false;
  }

  function syncWatches(): void {
    if (!abort) return;
    const allowIc = imageCaptureAllowed();
    for (const rec of records.values()) {
      if (!rec.usbPresent || !rec.usb) continue;
      for (const kind of classify(rec.usb)) {
        if (kind === 'image-capture' && !allowIc) continue;
        startKind(kind);
      }
    }
    if (allowIc) startKind('image-capture');
    else stopKind('image-capture');
  }

  function addUsb(device: UsbDeviceInfo): void {
    if (!isAppleDevice(device) && !isAndroidVendor(device) && !hasAdb(device) && !hasStillImage(device))
      return;
    const identity = usbIdentity(device);
    const rec = ensure(deviceKey(identity), identity);
    rec.usb = device;
    rec.usbPresent = true;
    rec.connected = true;
    rec.seenAt = deps.clock.now();
    rec.timedOut = false;
    rec.holder = null;
    rec.override = null;
    armTimer(rec);
    syncWatches();
    deps.log?.info(`usb ${rec.key} connected`);
    emit();
  }

  function removeUsb(device: UsbDeviceInfo): void {
    const rec = records.get(deviceKey(usbIdentity(device)));
    if (!rec) return;
    const locked = rec.session?.access().state === 'locked';
    flights.cancel(rec.key);
    rec.usbPresent = false;
    rec.connected = false;
    rec.timer?.cancel();
    dropSession(rec);
    syncWatches();
    emit();
    for (const listener of removed) listener(rec.key, locked);
  }

  function addRef(ref: BridgeDeviceRef): void {
    const rec = ensure(deviceKey(ref.identity), ref.identity);
    rec.refs.set(ref.bridge, ref);
    if (rec.usbPresent !== false) rec.connected = true;
    rec.timedOut = false;
    rec.timer?.cancel();
    rec.timer = null;
    emit();
  }

  function removeRef(ref: BridgeDeviceRef): void {
    const rec = records.get(deviceKey(ref.identity));
    if (!rec) return;
    const current = rec.refs.get(ref.bridge);
    if (current && current.handle !== ref.handle) return;
    rec.refs.delete(ref.bridge);
    if (rec.session?.ref.bridge === ref.bridge) dropSession(rec);
    if (rec.usbPresent !== true && rec.refs.size === 0) rec.connected = false;
    syncWatches();
    emit();
  }

  function ensure(key: string, identity: string): LiveDevice {
    const existing = records.get(key);
    if (existing) return existing;
    const created = newRecord(key, identity, deps.clock.now());
    records.set(key, created);
    return created;
  }

  function armTimer(rec: LiveDevice): void {
    rec.timer?.cancel();
    rec.timer = null;
    if (!rec.usb || !rec.usbPresent) return;
    if (isAppleDevice(rec.usb)) return;
    if (!hasAdb(rec.usb) && !hasStillImage(rec.usb)) return;
    if (rec.refs.size > 0) return;
    const delay = Math.max(0, rec.seenAt + BUSY_MS - deps.clock.now());
    rec.timer = schedule(delay, () => {
      rec.timer = null;
      if (rec.refs.size > 0 || !rec.connected) return;
      rec.timedOut = true;
      emit();
    });
  }

  function dropSession(rec: LiveDevice): void {
    rec.stopAccess?.();
    rec.stopAccess = null;
    const session = rec.session;
    rec.session = null;
    if (!session) return;
    sessions.drop(rec.key, session);
  }

  function open(key: string, signal: AbortSignal): AsyncResult<DeviceView> {
    const rec = records.get(key);
    if (!rec || !rec.connected) return Promise.resolve(err(DeviceGone()));
    return flights.run(key, signal, (shared) => doOpen(rec, shared));
  }

  async function doOpen(rec: LiveDevice, signal: AbortSignal): AsyncResult<DeviceView> {
    if (rec.session && !signal.aborted) return ok(toDeviceView(rec));
    await sessions.wait(rec.key, signal);
    if (signal.aborted || !rec.connected) return err(DeviceGone());
    if (rec.session) return ok(toDeviceView(rec));
    const order = rec.usb ? classify(rec.usb) : orderFromRefs(rec.refs);
    const apple = rec.usb ? isAppleDevice(rec.usb) : order.length === 1 && order[0] === 'image-capture';
    let lastError = DeviceGone();
    let attemptHolder: BusyHolder | null = null;
    for (const kind of order) {
      if (signal.aborted || !rec.connected) return err(DeviceGone());
      if (kind === 'image-capture' && !apple && attemptHolder !== 'camera-agent') continue;
      const bridge = byKind.get(kind);
      if (!bridge) continue;
      const probingIc = kind === 'image-capture' && !apple;
      if (probingIc) {
        icProbing += 1;
        syncWatches();
      }
      try {
        const waitForBridge =
          kind === 'image-capture' || (rec.usb !== null && rec.refs.size === 0 && bridge.claims(rec.usb));
        const ref = await waitForBridgeRef(rec, kind, waitForBridge, signal, listen, schedule, BUSY_MS);
        if (!ref) continue;
        const opened = await bridge.open(ref, signal);
        if (opened.ok) return ok(adopt(rec, opened.value));
        lastError = opened.error;
        const holder = busyHolder(opened.error);
        if (holder) attemptHolder = holder;
      } finally {
        if (probingIc) {
          icProbing = Math.max(0, icProbing - 1);
          syncWatches();
        }
      }
    }
    rec.holder = attemptHolder;
    rec.override = attemptHolder ? { state: 'busy', holder: attemptHolder } : null;
    emit();
    const view = toDeviceView(rec);
    if (rec.override || view.access !== 'opening') return ok(view);
    return err(lastError);
  }

  function adopt(rec: LiveDevice, session: BridgeSession): DeviceView {
    dropSession(rec);
    rec.session = session;
    rec.holder = null;
    rec.override = null;
    rec.stopAccess = session.onAccessChange((next) => {
      for (const listener of access) listener(rec.key, next);
      emit();
    });
    deps.log?.info(`usb ${rec.key} open ${session.ref.bridge}`);
    emit();
    return toDeviceView(rec);
  }

  function listen(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    retain,
    release,
    async close() {
      if (interest > 0) {
        interest = 0;
        stop();
      }
      await sessions.drain();
    },
    views: () => [...records.values()].map(toDeviceView).sort((a, b) => (a.key < b.key ? -1 : 1)),
    view: (key) => {
      const rec = records.get(key);
      return rec ? toDeviceView(rec) : null;
    },
    session: (key) => records.get(key)?.session ?? null,
    failure: () => watchFailure,
    listen,
    onRemoved(listener) {
      removed.add(listener);
      return () => removed.delete(listener);
    },
    onAccess(listener) {
      access.add(listener);
      return () => access.delete(listener);
    },
    open,
  };
}
