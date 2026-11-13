// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The bridge's helper endpoint over media's JSON-line sidecar (protocol v2). */
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import {
  createJsonLineSidecar,
  MediaCancelled,
  MediaTimeout,
  SidecarFailed,
  SidecarRejected,
  type JsonLineEvent,
  type JsonLineEventSidecar,
  type JsonLineRequestOptions,
  type JsonValue,
} from '@taalcut/media';
import { createHelperEndpoint, type HelperEvent } from '../../../src/bridges/image-capture/client';

const fixture = fileURLToPath(new URL('./fake-helper.mjs', import.meta.url));
const opened: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((item) => item.close()));
});

const READY_V2 = { type: 'ready', protocol: 2, services: ['devices'], serviceVersions: { devices: 1 } };

class FakeSidecar implements JsonLineEventSidecar {
  readyValue: Result<JsonValue> = ok(READY_V2);
  reply: Result<JsonValue> = ok({ ok: true });
  readonly requests: { method: string; timeoutMs: number | undefined }[] = [];
  private readonly listeners = new Set<(event: JsonLineEvent) => void>();

  async ready(): AsyncResult<JsonValue> {
    return this.readyValue;
  }

  async request(
    method: string,
    _params: JsonValue,
    options?: JsonLineRequestOptions,
  ): AsyncResult<JsonValue> {
    this.requests.push({ method, timeoutMs: options?.timeoutMs });
    return this.reply;
  }

  onEvent(listener: (event: JsonLineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: JsonLineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async close(): Promise<void> {}
}

const signal = () => new AbortController().signal;

describe('image capture helper endpoint', () => {
  it('refuses a protocol 1 helper and one without the devices service', async () => {
    const fake = new FakeSidecar();
    const endpoint = createHelperEndpoint(fake);
    fake.readyValue = ok({ type: 'ready', protocol: 1 });
    await expect(endpoint.request('devices.start', {}, signal())).rejects.toMatchObject({
      code: 'helper.service_version',
    });
    fake.readyValue = ok({ type: 'ready', protocol: 2, services: ['ocr'] });
    await expect(endpoint.request('devices.start', {}, signal())).rejects.toMatchObject({
      code: 'helper.service_not_started',
    });
    fake.readyValue = ok({ type: 'ready', protocol: 2, serviceVersions: { devices: 0 } });
    await expect(endpoint.request('devices.start', {}, signal())).rejects.toMatchObject({
      code: 'helper.service_version',
    });
    fake.readyValue = ok({ protocol: 2 });
    await expect(endpoint.request('devices.start', {}, signal())).rejects.toMatchObject({
      code: 'helper.bad_request',
    });
    fake.readyValue = err(SidecarFailed(undefined, { detail: 'sidecar printed no ready line' }));
    await expect(endpoint.request('devices.start', {}, signal())).rejects.toMatchObject({
      code: 'devices.session_failed',
    });
    expect(fake.requests).toEqual([]);
  });

  it('bounds every call but a download, and maps media errors to helper codes', async () => {
    const fake = new FakeSidecar();
    const endpoint = createHelperEndpoint(fake);
    await endpoint.request('devices.list', { handle: 'h' }, signal());
    await endpoint.request('devices.open', { handle: 'h' }, signal());
    await endpoint.request('devices.download', { handle: 'h' }, signal());
    expect(fake.requests).toEqual([
      { method: 'devices.list', timeoutMs: 60_000 },
      { method: 'devices.open', timeoutMs: 150_000 },
      { method: 'devices.download', timeoutMs: undefined },
    ]);
    const cases: [Result<JsonValue>, string][] = [
      [err(MediaTimeout({ ms: 60_000 })), 'helper.timeout'],
      [err(MediaCancelled()), 'helper.cancelled'],
      [err(SidecarRejected({ helperCode: 'devices.item_empty' })), 'devices.item_empty'],
      [err(SidecarFailed({ helperCode: 'devices.download_failed' })), 'devices.download_failed'],
      [err(SidecarFailed({ helperCode: '/private/secret' })), 'devices.session_failed'],
      [err(SidecarFailed(undefined, { detail: 'sidecar exited' })), 'devices.session_failed'],
    ];
    for (const [reply, code] of cases) {
      fake.reply = reply;
      await expect(endpoint.request('devices.list', {}, signal())).rejects.toMatchObject({ code });
    }
    const controller = new AbortController();
    controller.abort();
    await expect(endpoint.request('devices.list', {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('forwards event lines and announces a restarted helper once', async () => {
    const fake = new FakeSidecar();
    const endpoint = createHelperEndpoint(fake);
    const seen: HelperEvent[] = [];
    const off = endpoint.onEvent((event) => seen.push(event));
    fake.emit({ service: 'devices', name: 'device.added', data: { handle: 'h1' } });
    await endpoint.request('devices.start', {}, signal());
    await endpoint.request('devices.start', {}, signal());
    fake.readyValue = ok({ ...READY_V2 });
    await endpoint.request('devices.start', {}, signal());
    await endpoint.request('devices.start', {}, signal());
    expect(seen).toEqual([
      { name: 'device.added', payload: { handle: 'h1' } },
      { name: 'helper.restarted', payload: {} },
    ]);
    off();
    fake.emit({ service: 'devices', name: 'device.removed', data: { handle: 'h1' } });
    expect(seen).toHaveLength(2);
  });

  it('talks to a protocol v2 process and starts a new one after a crash', async () => {
    const sidecar = createJsonLineSidecar({
      command: process.execPath,
      args: [fixture],
      readyTimeoutMs: 5_000,
    });
    opened.push(sidecar);
    const endpoint = createHelperEndpoint(sidecar);
    const names: string[] = [];
    endpoint.onEvent((event) => names.push(event.name));
    expect(await endpoint.request('devices.start', {}, signal())).toEqual({ ok: true });
    expect(names).toEqual(['device.added']);
    await expect(endpoint.request('devices.open', { handle: 'x' }, signal())).rejects.toMatchObject({
      code: 'devices.not_found',
      message: 'devices.not_found',
    });
    await expect(endpoint.request('die', {}, signal())).rejects.toMatchObject({
      code: 'devices.session_failed',
    });
    expect(await endpoint.request('devices.start', {}, signal())).toEqual({ ok: true });
    expect(names).toEqual(['device.added', 'helper.restarted', 'device.added']);
  });

  it('refuses a protocol 1 process', async () => {
    const sidecar = createJsonLineSidecar({ command: process.execPath, args: [fixture, '--v1'] });
    opened.push(sidecar);
    const endpoint = createHelperEndpoint(sidecar);
    await expect(endpoint.request('devices.start', {}, signal())).rejects.toMatchObject({
      code: 'helper.service_version',
    });
  });
});
