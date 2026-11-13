// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { callRpc, parseId, type ThemePreference, traceSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { TRACE_FIXTURES } from '../src/backend/fake/trace-fixtures';
import { createFakeBackend } from '../src/backend/fake/fake-backend';

function themeTarget() {
  let preference: ThemePreference = 'system';
  return {
    getPreference: () => preference,
    setPreference: (next: ThemePreference) => void (preference = next),
  };
}

describe('fake backend over a MessageChannel', () => {
  it('serves model settings and runs model commands through the real command bus', async () => {
    const { client, controls } = createFakeBackend({ today: () => '2026-10-12' });
    const before = await client.models.settings();
    expect(before.activeProfileId).toBe('balanced');
    expect(before.retirements.map((n) => n.choice.model)).toContain('openai/gpt-image-1');

    await client.commands.dispatch({ name: 'models.setProfile', payload: { profileId: 'fast-cheap' } });
    expect(controls.call('agent')).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' });

    await client.commands.undo({ projectId: null });
    expect(controls.call('agent')).toMatchObject({ provider: 'openai', model: 'gpt-6.1-sol' });
    expect(controls.dispatched.map((d) => d.name)).toEqual(['models.setProfile']);
  });

  it('streams the current settings first, then each change', async () => {
    const { client } = createFakeBackend();
    const controller = new AbortController();
    const stream = await client.models.changed(undefined, { signal: controller.signal });
    const seen: string[] = [];
    for await (const settings of stream) {
      seen.push(settings.activeProfileId);
      if (seen.length === 1)
        void client.commands.dispatch({ name: 'models.setProfile', payload: { profileId: 'local-only' } });
      else break;
    }
    expect(seen).toEqual(['balanced', 'local-only']);
  });

  it('rejects a bad command payload as a typed validation error', async () => {
    const { client } = createFakeBackend();
    const result = await callRpc(
      client.commands.dispatch({ name: 'models.setProfile', payload: { profileId: 'nope' } }),
    );
    expect(result.ok ? null : result.error.code).toBe('core.validation');
  });

  it('switches the theme through settings.setTheme and undoes it', async () => {
    const theme = themeTarget();
    const { client } = createFakeBackend({ theme });
    await client.commands.dispatch({ name: 'settings.setTheme', payload: { preference: 'dark' } });
    expect(theme.getPreference()).toBe('dark');
    await client.commands.undo({ projectId: null });
    expect(theme.getPreference()).toBe('system');
  });

  it('never returns an API key, and tests it', async () => {
    const { client } = createFakeBackend();
    const state = await client.accounts.setApiKey({ provider: 'openai', key: 'sk-test-1234567890' });
    expect(JSON.stringify(state)).not.toContain('sk-test');
    expect(state.apiKeys.find((k) => k.provider === 'openai')?.configured).toBe(true);
    expect((await client.accounts.testApiKey({ provider: 'openai' })).ok).toBe(true);
    await client.accounts.setApiKey({ provider: 'anthropic', key: 'sk-bad-1234567890' });
    expect(await client.accounts.testApiKey({ provider: 'anthropic' })).toMatchObject({
      ok: false,
      errorCode: 'models.auth_invalid',
    });
  });

  it('refuses a server address with a user name or password, and keeps none', async () => {
    const { client } = createFakeBackend();
    const refused = await callRpc(
      client.accounts.setLocalServer({ kind: 'ollama', baseUrl: 'http://me:hunter2@localhost:11434' }),
    );
    expect(refused).toMatchObject({ ok: false, error: { code: 'models.endpoint_has_credentials' } });
    const state = await client.accounts.state();
    expect(JSON.stringify(state)).not.toContain('hunter2');
    expect(state.localServers.find((s) => s.kind === 'ollama')?.baseUrl).toBeUndefined();
  });

  it('serves fixture traces that match the trace schema and have valid run ids', async () => {
    const { client } = createFakeBackend();
    for (const trace of TRACE_FIXTURES) {
      expect(parseId(trace.runId).ok, trace.runId).toBe(true);
      expect(traceSchema.safeParse(trace).success).toBe(true);
    }
    const runs = await client.traces.runs({});
    expect(runs.map((r) => r.status)).toEqual(['running', 'failed', 'succeeded']);
    const gate = await client.traces.get({ runId: runs[2]!.runId });
    expect(gate.spans.filter((s) => s.kind === 'tool').map((s) => s.tool)).toEqual([
      'library.addSource',
      'media.probe',
      'media.probe',
      'vision.describeFrame',
    ]);
  });
});
