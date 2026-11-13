// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, describe, expect, it } from 'vitest';
import { type PluginService } from '@taalcut/core';
import { pluginWorld } from './service-support';

const services: PluginService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
});
function world() {
  const result = pluginWorld();
  services.push(result.service);
  return result;
}

describe('plugin registry lifecycle and access', () => {
  it('discovers inactive plugins and skills without network or credentials', async () => {
    const { service, network } = world();
    network(false);
    const list = await service.list();
    expect(list.ok && list.value.map((entry) => entry.manifest.id)).toEqual(['alpha', 'beta']);
    expect(await service.readSkill('alpha', 'workflow')).toMatchObject({
      ok: true,
      value: { content: 'Inspect records before publishing.' },
    });
    expect(await service.requestSetup('alpha')).toMatchObject({
      ok: true,
      value: { enabled: false, setupRequested: true },
    });
    expect((await service.describe('missing')).ok).toBe(false);
  });

  it('requires credentials, activation and operation-specific access, checking again on every call', async () => {
    const { service, activate, invoked } = world();
    const read = { pluginId: 'alpha', toolName: 'api.list', input: {}, mode: 'read' as const };
    expect((await service.invoke(read)).ok).toBe(false);
    expect((await service.setEnabled({ pluginId: 'alpha', enabled: true })).ok).toBe(false);
    expect((await activate('alpha', ['read'])).ok).toBe(true);
    expect((await service.invoke(read)).ok).toBe(true);
    expect((await service.invoke({ ...read, toolName: 'api.publish' })).ok).toBe(false);
    expect((await service.invoke({ ...read, toolName: 'api.publish', mode: 'external' })).ok).toBe(false);
    await service.setAccess({ pluginId: 'alpha', access: [] });
    expect((await service.invoke(read)).ok).toBe(false);
    expect(invoked).toHaveBeenCalledTimes(1);
    expect((await service.setAccess({ pluginId: 'alpha', access: ['undeclared'] })).ok).toBe(false);
  });

  it('refuses external tools on the read path even when every grant is present', async () => {
    const { service, activate, invoked } = world();
    await activate();
    const input = { pluginId: 'alpha', toolName: 'api.publish', input: {}, mode: 'read' as const };
    expect((await service.invoke(input)).ok).toBe(false);
    expect(invoked).not.toHaveBeenCalled();
    expect((await service.invoke({ ...input, mode: 'external', idempotencyKey: 'publish-1' })).ok).toBe(true);
  });

  it('blocks test, discovery and calls while local-only is on, including an already connected adapter', async () => {
    const { service, activate, network, invoked } = world();
    await activate();
    network(false);
    expect((await service.testConnection('alpha')).ok).toBe(false);
    expect((await service.tools('alpha')).ok).toBe(false);
    expect(
      (await service.invoke({ pluginId: 'alpha', toolName: 'api.list', input: {}, mode: 'read' })).ok,
    ).toBe(false);
    expect(invoked).not.toHaveBeenCalled();
  });

  it('persists grants and activation while keeping credentials out of metadata', async () => {
    const { service, activate, create } = world();
    await activate('alpha', ['read']);
    const replacement = create();
    services.push(replacement);
    expect(await replacement.describe('alpha')).toMatchObject({
      ok: true,
      value: { enabled: true, grantedAccess: ['read'], configuredCredentials: ['key'] },
    });
    expect(JSON.stringify(await service.list())).not.toContain('alpha-test-secret');
  });

  it('isolates data and secrets, and disconnect clears only the selected plugin', async () => {
    const { service, activate, contexts, values } = world();
    await activate('alpha');
    await activate('beta');
    await service.tools('alpha');
    await service.tools('beta');
    const alpha = contexts.get('alpha')!;
    const beta = contexts.get('beta')!;
    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    expect((await alpha.secrets.get('beta.key')).ok).toBe(false);
    expect(await alpha.secrets.get('key')).toEqual({ ok: true, value: 'alpha-test-secret' });
    await alpha.data.set('cache', { owner: 'alpha' });
    await beta.data.set('cache', { owner: 'beta' });
    expect(await alpha.data.get('cache')).toEqual({ ok: true, value: { owner: 'alpha' } });
    expect((await alpha.data.set('../beta', {})).ok).toBe(false);
    expect(await service.disconnect('alpha')).toMatchObject({
      ok: true,
      value: { enabled: false, configuredCredentials: [], grantedAccess: [] },
    });
    expect([...values.values()]).toEqual(['beta-test-secret']);
    expect(await beta.data.get('cache')).toEqual({ ok: true, value: { owner: 'beta' } });
    expect(await alpha.data.get('cache')).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    await activate('alpha');
    expect(await contexts.get('alpha')!.data.get('cache')).toEqual({ ok: true, value: undefined });
  });

  it('requires re-importing credentials after changing the instance', async () => {
    const { service, activate, values, invoked } = world();
    await activate();
    expect(
      (await service.configure({ pluginId: 'alpha', config: { url: 'https://other.example.com' } })).ok,
    ).toBe(true);
    expect([...values.values()]).not.toContain('alpha-test-secret');
    expect(
      (await service.invoke({ pluginId: 'alpha', toolName: 'api.list', input: {}, mode: 'read' })).ok,
    ).toBe(false);
    expect(invoked).not.toHaveBeenCalled();
    expect(
      (await service.configure({ pluginId: 'alpha', config: { url: 'https://example.com', secret: 'bad' } }))
        .ok,
    ).toBe(false);
  });

  it('aborts active calls immediately when access is revoked', async () => {
    const { service, activate, invoked } = world();
    await activate();
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    invoked.mockImplementationOnce(async (_name, _input, signal) => {
      started();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      return { ok: true, value: { cancelled: signal.aborted } };
    });
    const pending = service.invoke({ pluginId: 'alpha', toolName: 'api.list', input: {}, mode: 'read' });
    await began;
    await service.setEnabled({ pluginId: 'alpha', enabled: false });
    await pending;
    expect(await service.describe('alpha')).toMatchObject({ ok: true, value: { enabled: false } });
  });
});
