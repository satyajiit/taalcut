// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ImageCaptureCore bridge over the mac helper's `devices` service. The helper
 * endpoint is injected (`connect`), created on the first watch or open and
 * closed once no watch and no session uses it. When the helper is replaced (a crash, then
 * a restart on the next request), every handle it gave out is gone: open
 * sessions are marked removed and a running watch asks for the devices again.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import type { BridgeDeviceRef, BridgeSession, DeviceBridge, UsbDeviceInfo } from '../../usb/bridge';
import { guardBridgeSessions } from '../../usb/bridge-guard';
import { DeviceBusy } from '../../usb/errors';
import { HELPER_RESTARTED, type HelperEndpoint, type HelperEvent } from './client';
import { bridgeFailure, HelperRequestError } from './failures';
import { Gate } from './gate';
import {
  claimsImageCapture,
  handleOf,
  mapAccessEvent,
  mapDeviceRef,
  mapOpen,
  progressBytes,
  readCloud,
  type MappedRef,
} from './map';
import { callHelper, LiveSession } from './session';
import { openPtpBackedSession, type PtpBackedSession } from './ptp-pipe';

export type { HelperEndpoint, HelperEvent } from './client';

export interface ImageCaptureBridgeOptions {
  readonly connect: () => Promise<HelperEndpoint>;
  /** A folder the helper may write to (`--allow-root`) for thumbnails: the lan process's thumbs root. */
  readonly scratchDir: string;
}

type WatchEvent = { readonly type: 'added' | 'removed'; readonly ref: BridgeDeviceRef };
/** What a watch loop reads: a device change, or "the helper restarted: ask for the devices again". */
type WatchSignal = WatchEvent | { readonly type: 'restart' };

export function createImageCaptureBridge(options: ImageCaptureBridgeOptions): DeviceBridge {
  return guardBridgeSessions(new ImageCaptureBridge(options));
}

class ImageCaptureBridge implements DeviceBridge {
  readonly kind = 'image-capture' as const;
  private readonly refs = new Map<string, MappedRef>();
  private readonly sessions = new Set<LiveSession>();
  private readonly ptpSessions = new Set<PtpBackedSession>();
  private readonly watchers = new Set<(signal: WatchSignal) => void>();
  private readonly gone = new Set<string>();
  private endpoint: HelperEndpoint | undefined;
  private stopEvents: (() => void) | undefined;
  private opening: Promise<HelperEndpoint> | undefined;

  constructor(private readonly options: ImageCaptureBridgeOptions) {}

  claims(device: UsbDeviceInfo): boolean {
    return claimsImageCapture(device);
  }

  async *watch(signal: AbortSignal): AsyncIterable<WatchEvent> {
    const endpoint = await this.connect();
    const queue = new Gate<WatchSignal>();
    const listener = (next: WatchSignal): void => queue.push(next);
    this.watchers.add(listener);
    try {
      await callHelper(endpoint, 'devices.start', {}, signal);
      while (!signal.aborted) {
        const next = await queue.take(signal);
        if (next === undefined) return;
        if (next.type === 'restart') {
          await callHelper(endpoint, 'devices.start', {}, signal);
          continue;
        }
        yield next;
      }
    } finally {
      this.watchers.delete(listener);
      queue.close();
      await this.releaseIfIdle();
    }
  }

  async open(ref: BridgeDeviceRef, signal: AbortSignal): AsyncResult<BridgeSession> {
    const context = { removed: this.gone.has(ref.handle), access: { state: 'ready' as const } };
    try {
      if (context.removed) return err(bridgeFailure(new HelperRequestError('devices.not_found'), context));
      const endpoint = await this.connect();
      const payload = await callHelper(endpoint, 'devices.open', { handle: ref.handle }, signal);
      const opened = mapOpen(payload);
      if (!opened) throw new HelperRequestError('devices.session_failed');
      const sessionRef = this.remember(ref, opened.cloud);
      if (sessionRef.platform !== 'ios' && opened.access.state === 'ready') {
        if (opened.ptp) {
          const ptpOpened = await openPtpBackedSession(
            endpoint,
            sessionRef,
            () => this.gone.has(ref.handle),
            (closed) => {
              this.ptpSessions.delete(closed);
              return this.releaseIfIdle();
            },
            signal,
          );
          if (ptpOpened.ok) this.ptpSessions.add(ptpOpened.value);
          return ptpOpened;
        }
        if (opened.count === 0) {
          await callHelper(
            endpoint,
            'devices.close',
            { handle: ref.handle },
            AbortSignal.timeout(5_000),
          ).catch(() => undefined);
          await this.releaseIfIdle();
          return err(DeviceBusy(undefined, { detail: 'camera-agent' }));
        }
      }
      context.removed = this.gone.has(ref.handle);
      if (context.removed) return err(bridgeFailure(new HelperRequestError('devices.not_found'), context));
      const session = new LiveSession(
        endpoint,
        sessionRef,
        opened.access,
        this.options.scratchDir,
        (closed) => {
          this.sessions.delete(closed);
          return this.releaseIfIdle();
        },
      );
      this.sessions.add(session);
      return ok(session);
    } catch (cause) {
      return err(bridgeFailure(cause, { removed: this.gone.has(ref.handle), access: context.access }));
    }
  }

  private remember(ref: BridgeDeviceRef, cloud: boolean | undefined): MappedRef {
    const stored = this.refs.get(ref.handle);
    const next: MappedRef = stored ?? {
      bridge: 'image-capture',
      handle: ref.handle,
      identity: ref.identity,
      label: ref.label,
      platform: ref.platform === 'ios' ? 'ios' : 'other',
    };
    if (cloud !== undefined) next.iCloudPhotos = cloud;
    this.refs.set(ref.handle, next);
    return next;
  }

  private connect(): Promise<HelperEndpoint> {
    if (this.endpoint) return Promise.resolve(this.endpoint);
    if (this.opening) return this.opening;
    this.opening = this.options.connect().then(
      (endpoint) => {
        this.endpoint = endpoint;
        this.stopEvents = endpoint.onEvent((event) => this.onEvent(event));
        return endpoint;
      },
      (cause: unknown) => {
        this.opening = undefined;
        throw cause;
      },
    );
    return this.opening;
  }

  private onEvent(event: HelperEvent): void {
    if (event.name === HELPER_RESTARTED) {
      this.forgetHandles();
      return;
    }
    if (event.name === 'device.added') {
      const ref = mapDeviceRef(event.payload);
      if (!ref) return;
      this.gone.delete(ref.handle);
      this.refs.set(ref.handle, ref);
      this.publish({ type: 'added', ref });
      return;
    }
    const handle = handleOf(event.payload);
    if (!handle) return;
    if (event.name === 'device.removed') {
      this.drop(handle);
      return;
    }
    const cloud = readCloud(event.payload);
    const known = this.refs.get(handle);
    if (cloud !== undefined && known) known.iCloudPhotos = cloud;
    if (event.name === 'device.access') {
      const access = mapAccessEvent(event.payload);
      if (!access) return;
      for (const session of this.sessions) {
        if (session.ref.handle === handle) session.setAccess(access);
      }
      return;
    }
    if (event.name !== 'download.progress') return;
    const progress = progressBytes(event.payload);
    if (!progress) return;
    for (const session of this.sessions) {
      if (session.ref.handle === handle) session.noteBytes(progress.id, progress.bytes);
    }
  }

  /** The device behind `handle` went away: its sessions fail with DeviceGone from now on. */
  private drop(handle: string): void {
    this.gone.add(handle);
    const ref = this.refs.get(handle);
    this.refs.delete(handle);
    for (const session of this.sessions) {
      if (session.ref.handle === handle) session.markRemoved();
    }
    for (const session of this.ptpSessions) {
      if (session.ref.handle === handle) session.markRemoved();
    }
    if (ref) this.publish({ type: 'removed', ref });
  }

  /** A new helper process: every device it had is reported removed, then the watches start it again. */
  private forgetHandles(): void {
    const handles = new Set([
      ...this.refs.keys(),
      ...[...this.sessions].map((session) => session.ref.handle),
      ...[...this.ptpSessions].map((session) => session.ref.handle),
    ]);
    for (const handle of handles) this.drop(handle);
    for (const listener of this.watchers) listener({ type: 'restart' });
  }

  private publish(event: WatchEvent): void {
    for (const listener of this.watchers) listener(event);
  }

  /** Called after a watch ends and after a session closes: the helper stops when nothing uses it. */
  private async releaseIfIdle(): Promise<void> {
    if (this.watchers.size > 0 || this.sessions.size > 0 || this.ptpSessions.size > 0) return;
    const endpoint = this.endpoint;
    this.endpoint = undefined;
    this.opening = undefined;
    this.stopEvents?.();
    this.stopEvents = undefined;
    if (!endpoint) return;
    await endpoint.close();
  }
}
