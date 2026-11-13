// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, describe, expect, it } from 'vitest';
import { err, ok, ValidationError, type PluginService } from '@taalcut/core';
import { pluginWorld } from './service-support';

const services: PluginService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
});
const call = {
  pluginId: 'alpha',
  toolName: 'api.publish',
  input: { text: 'Hello' },
  mode: 'external' as const,
  idempotencyKey: 'one-publish',
};

describe('durable plugin calls', () => {
  it('deduplicates external actions across restart and refuses key reuse with a different payload', async () => {
    const { service, activate, create, invoked } = pluginWorld();
    services.push(service);
    await activate();
    expect((await service.invoke(call)).ok).toBe(true);
    const again = create();
    services.push(again);
    expect(await again.invoke(call)).toEqual(ok({ text: 'Hello' }));
    expect((await again.invoke({ ...call, input: { text: 'Different' } })).ok).toBe(false);
    expect(invoked).toHaveBeenCalledTimes(1);
  });

  it('does not retry an ambiguous external failure', async () => {
    const { service, activate, invoked } = pluginWorld();
    services.push(service);
    await activate();
    invoked.mockImplementationOnce(async () => err(ValidationError({ field: 'remote' })));
    expect((await service.invoke(call)).ok).toBe(false);
    expect((await service.invoke(call)).ok).toBe(false);
    expect(invoked).toHaveBeenCalledTimes(1);
  });

  it('redacts credentials echoed by a provider before returning or persisting the result', async () => {
    const { service, activate, invoked, create } = pluginWorld();
    services.push(service);
    await activate();
    invoked.mockImplementationOnce(async () => ok({ reflected: 'alpha-test-secret' }));
    const result = await service.invoke(call);
    expect(result).toEqual(ok({ reflected: '[REDACTED]' }));
    const again = create();
    services.push(again);
    expect(await again.invoke(call)).toEqual(result);
  });

  it('cancels a provider that ignores abort instead of waiting forever', async () => {
    const { service, activate, invoked } = pluginWorld();
    services.push(service);
    await activate();
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    invoked.mockImplementationOnce(() => {
      started();
      return new Promise(() => undefined);
    });
    const controller = new AbortController();
    const pending = service.invoke({ ...call, toolName: 'api.list', mode: 'read' }, controller.signal);
    await began;
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
  });

  it('cannot start a replacement adapter while access revocation is disposing the old one', async () => {
    const { service, activate, invoked, disposed } = pluginWorld();
    services.push(service);
    await activate();
    let disposing!: () => void;
    let release!: () => void;
    const began = new Promise<void>((resolve) => {
      disposing = resolve;
    });
    disposed.mockImplementationOnce(() => {
      disposing();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const revoking = service.setAccess({ pluginId: 'alpha', access: [] });
    await began;
    const pending = service.invoke({ ...call, toolName: 'api.list', mode: 'read' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    await revoking;
    expect((await pending).ok).toBe(false);
    expect(invoked).not.toHaveBeenCalled();
  });

  it('suspends live transports without forgetting activation, then reconnects when network returns', async () => {
    const { service, activate, disposed, network } = pluginWorld();
    services.push(service);
    await activate();
    network(false);
    await service.suspendNetwork();
    expect(disposed).toHaveBeenCalledOnce();
    expect(await service.describe('alpha')).toMatchObject({
      ok: true,
      value: { enabled: true, configuredCredentials: ['key'] },
    });
    expect((await service.tools('alpha')).ok).toBe(false);
    network(true);
    expect((await service.tools('alpha')).ok).toBe(true);
  });
});
