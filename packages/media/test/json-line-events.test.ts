// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Protocol v2 event lines, a dead stdin, a silent start and a restart (P3-B4). */
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SidecarFailed, createJsonLineSidecar, type JsonLineEvent } from '@taalcut/media';

const fakeHelper = fileURLToPath(new URL('./fixtures/fake-mac-helper-v2.mjs', import.meta.url));
const sidecars: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(sidecars.splice(0).map((sidecar) => sidecar.close()));
});

function open(args: string[] = [], readyTimeoutMs?: number) {
  const sidecar = createJsonLineSidecar({
    command: process.execPath,
    args: [fakeHelper, ...args],
    ...(readyTimeoutMs === undefined ? {} : { readyTimeoutMs }),
  });
  sidecars.push(sidecar);
  return sidecar;
}

function pidOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'pid' in value ? value.pid : undefined;
}

describe('json-line sidecar events', () => {
  it('delivers event lines to listeners until they unsubscribe', async () => {
    const sidecar = open();
    const seen: JsonLineEvent[] = [];
    const off = sidecar.onEvent((event) => seen.push(event));
    const started = await sidecar.request('devices.start', {});
    expect(started.ok).toBe(true);
    expect(seen).toEqual([
      { service: 'devices', name: 'device.added', data: { handle: 'h1', label: 'Phone' } },
      { service: undefined, name: 'device.catalog', data: { handle: 'h1', percent: 100 } },
    ]);
    off();
    await sidecar.request('devices.start', {});
    expect(seen).toHaveLength(2);
  });

  it('keeps listeners across a crash and restarts on the next request', async () => {
    const sidecar = open();
    const names: string[] = [];
    sidecar.onEvent((event) => names.push(event.name));
    const first = await sidecar.request('pid', {});
    const crashed = await sidecar.request('die', {});
    expect(crashed.ok).toBe(false);
    if (!crashed.ok) expect(SidecarFailed.is(crashed.error)).toBe(true);
    const second = await sidecar.request('pid', {});
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(pidOf(second.value)).not.toBe(pidOf(first.value));
    await sidecar.request('devices.start', {});
    expect(names).toContain('device.added');
  });

  it("gives onSend the helper's pid before the request goes out, and nothing for one never sent (IX3-F7)", async () => {
    const sidecar = open();
    const sent: number[] = [];
    const answered = await sidecar.request('pid', {}, { onSend: (pid) => sent.push(pid) });
    expect(answered.ok && pidOf(answered.value)).toBe(sent[0]);
    expect(sent).toHaveLength(1);
    const aborted = new AbortController();
    aborted.abort();
    const unsent = await sidecar.request(
      'pid',
      {},
      { signal: aborted.signal, onSend: (pid) => sent.push(pid) },
    );
    expect(unsent.ok).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('turns a write into a closed stdin into a failure, not an uncaught EPIPE', async () => {
    // The shell closes the pipe's only read end, then runs the helper, which stays up and prints ready.
    const sidecar = createJsonLineSidecar({
      command: '/bin/sh',
      args: ['-c', 'exec 0<&-; exec "$0" "$1" --stay', process.execPath, fakeHelper],
    });
    sidecars.push(sidecar);
    const ready = await sidecar.ready();
    expect(ready.ok).toBe(true);
    const broken = await sidecar.request('pid', {}, { timeoutMs: 5_000 });
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(SidecarFailed.is(broken.error)).toBe(true);
      expect(broken.error.detail).toContain('sidecar stdin');
    }
  });

  it('fails a start that prints no ready line within the timeout', async () => {
    const sidecar = open(['--silent'], 200);
    const ready = await sidecar.ready();
    expect(ready.ok).toBe(false);
    if (!ready.ok) {
      expect(SidecarFailed.is(ready.error)).toBe(true);
      expect(ready.error.detail).toBe('sidecar printed no ready line');
    }
  });
});
