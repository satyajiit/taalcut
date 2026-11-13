// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectRpc, serveRpc, updatesContract } from '@taalcut/core';
import { UpdateNotNewer } from '../src/main/update/candidate';
import { createUpdateHost, type UpdateHost, type UpdateSession } from '../src/main/update/host';
import { updatesRouter } from '../src/main/update/router';
import type { UpdateEvent } from '../src/main/update/updater';

const ports: MessageChannel[] = [];
afterEach(() => {
  for (const { port1, port2 } of ports.splice(0)) {
    port1.close();
    port2.close();
  }
});

function alphaHost(enabled = true) {
  const updates = {
    checkNow: vi.fn(async () => undefined),
    installNow: vi.fn(),
  };
  const host = createUpdateHost({
    version: '0.0.0-alpha.1',
    channel: 'alpha',
    enabled,
    clock: () => 1_700_000_000_000,
  });
  const session: UpdateSession = {
    checkNow: () => updates.checkNow(),
    installNow: () => updates.installNow(),
  };
  host.attach(session);
  return { host, updates };
}

function clientFor(host: UpdateHost) {
  const channel = new MessageChannel();
  ports.push(channel);
  serveRpc(updatesRouter(host), channel.port1, { context: {} });
  return connectRpc(updatesContract, channel.port2, { peer: 'main' }).client;
}

describe('update host', () => {
  it('stays off, with no channel, when there is no feed', async () => {
    const { host, updates } = alphaHost(false);
    expect(host.state()).toEqual({
      version: '0.0.0-alpha.1',
      channel: null,
      choice: null,
      status: { kind: 'off' },
      lastRollback: null,
    });
    host.apply({ type: 'checking', feedUrl: 'https://feed.example/' });
    expect(host.state().status).toEqual({ kind: 'off' });
    expect(await host.check()).toMatchObject({ status: { kind: 'off' } });
    expect(updates.checkNow).not.toHaveBeenCalled();
    await expect(host.installNow()).rejects.toMatchObject({ data: { code: 'desktop.update_not_ready' } });
    expect(updates.installNow).not.toHaveBeenCalled();
  });

  it('maps the event stream onto checking, downloading and ready', () => {
    const { host } = alphaHost();
    expect(host.state()).toEqual({
      version: '0.0.0-alpha.1',
      channel: 'alpha',
      choice: null,
      status: { kind: 'idle' },
      lastRollback: null,
    });
    const events: UpdateEvent[] = [
      { type: 'checking', feedUrl: 'https://feed.example/alpha/' },
      { type: 'available', version: '0.0.0-alpha.2' },
      { type: 'progress', percent: 41.6 },
      { type: 'downloaded', version: '0.0.0-alpha.2' },
      { type: 'verified', version: '0.0.0-alpha.2', team: 'WW382UC8JD' },
      { type: 'staged' },
    ];
    for (const event of events) host.apply(event);
    expect(host.state().status).toEqual({ kind: 'ready', version: '0.0.0-alpha.2' });
  });

  it('keeps a staged update ready across a later check, and installs only then', async () => {
    const { host, updates } = alphaHost();
    host.apply({ type: 'available', version: '0.0.0-alpha.2' });
    host.apply({ type: 'staged' });
    host.apply({ type: 'checking', feedUrl: 'https://feed.example/' });
    host.apply({ type: 'not-available', version: '0.0.0-alpha.2' });
    host.apply({ type: 'error', message: 'https://feed.example/secret' });
    expect(host.state().status).toEqual({ kind: 'ready', version: '0.0.0-alpha.2' });
    expect(JSON.stringify(host.state())).not.toContain('secret');
    await host.installNow();
    expect(updates.installNow).toHaveBeenCalledOnce();
  });

  it('refuses installNow until ready, and publishes a public error without detail', async () => {
    const { host, updates } = alphaHost();
    await expect(host.installNow()).rejects.toMatchObject({ data: { code: 'desktop.update_not_ready' } });
    const refusal = UpdateNotNewer(
      { version: '0.0.0-alpha.1', running: '0.0.0-alpha.1' },
      { detail: '/Users/secret/Taalcut.app' },
    );
    host.apply({ type: 'rejected', error: refusal });
    expect(host.state().status).toEqual({
      kind: 'error',
      error: {
        code: 'desktop.update_not_newer',
        messageKey: 'errors.desktop.update_not_newer',
        retryable: false,
        params: { version: '0.0.0-alpha.1', running: '0.0.0-alpha.1' },
      },
    });
    expect(JSON.stringify(host.state())).not.toContain('secret');
    host.apply({ type: 'error', message: 'token=abc' });
    expect(host.state().status).toEqual({
      kind: 'error',
      error: {
        code: 'desktop.update_check_failed',
        messageKey: 'errors.desktop.update_check_failed',
        retryable: true,
      },
    });
    expect(JSON.stringify(host.state())).not.toContain('token');
    expect(updates.installNow).not.toHaveBeenCalled();
  });

  it('records an idle check, and clamps a download percent', async () => {
    const { host, updates } = alphaHost();
    host.apply({ type: 'not-available', version: '0.0.0-alpha.1' });
    expect(host.state().status).toEqual({ kind: 'idle', checkedAt: 1_700_000_000_000 });
    host.apply({ type: 'available', version: '0.0.0-alpha.2' });
    host.apply({ type: 'progress', percent: 140 });
    expect(host.state().status).toEqual({ kind: 'downloading', version: '0.0.0-alpha.2', percent: 100 });
    host.apply({ type: 'progress', percent: -4 });
    expect(host.state().status).toMatchObject({ percent: 0 });
    await host.check();
    expect(updates.checkNow).toHaveBeenCalledOnce();
  });

  it('shows the baked channel only while a feed is on', () => {
    const host = createUpdateHost({ version: '1.0.0', channel: null, enabled: false });
    host.configure({ version: '1.0.0', channel: 'internal', enabled: true });
    expect(host.state()).toEqual({
      version: '1.0.0',
      channel: 'internal',
      choice: null,
      status: { kind: 'idle' },
      lastRollback: null,
    });
    host.configure({ version: '1.0.0', channel: 'internal', enabled: false });
    expect(host.state()).toEqual({
      version: '1.0.0',
      channel: null,
      choice: null,
      status: { kind: 'off' },
      lastRollback: null,
    });
    expect(() => createUpdateHost({ version: ' ', channel: null, enabled: false })).toThrow(/version/);
  });
});

describe('updatesRouter', () => {
  it('serves state, then changes, and refuses installNow until ready', async () => {
    const { host } = alphaHost();
    const client = clientFor(host);
    expect(await client.state()).toMatchObject({
      version: '0.0.0-alpha.1',
      channel: 'alpha',
      status: { kind: 'idle' },
    });
    await expect(client.installNow()).rejects.toMatchObject({ data: { code: 'desktop.update_not_ready' } });

    const controller = new AbortController();
    const stream = await client.changed(undefined, { signal: controller.signal });
    expect((await stream.next()).value).toMatchObject({ status: { kind: 'idle' } });
    host.apply({ type: 'checking', feedUrl: 'https://feed.example/' });
    expect((await stream.next()).value).toMatchObject({ status: { kind: 'checking' } });
    host.apply({ type: 'available', version: '0.0.0-alpha.2' });
    host.apply({ type: 'staged' });
    expect((await stream.next()).value).toMatchObject({
      status: { kind: 'ready', version: '0.0.0-alpha.2' },
    });
    controller.abort();
  });
});
