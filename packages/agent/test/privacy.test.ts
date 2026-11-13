// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X2 "the panel matches the CloudCall log": Settings → Privacy's overview,
 * module by module, counted from the same CloudCall rows Settings → Usage
 * lists; Local only and the other network flows; standing consents; the
 * `changed` stream over a port.
 */
import {
  connectRpc,
  CRASH_REPORTS_SETTING,
  createMemorySettingsStore,
  err,
  LOCAL_ONLY_SETTING,
  newId,
  ok,
  privacyContract,
  privacyOverviewSchema,
  serveRpc,
  TELEMETRY_SETTING,
  unwrap,
  type CloudCallRecord,
  type ModelModuleId,
  type PrivacyOverview,
} from '@taalcut/core';
import {
  createMemoryConsentStore,
  createPrivacyService,
  moduleTraffic,
  privacyRouter,
  type PrivacyModulePlan,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { channel } from './support/ports';

const NOW = Date.UTC(2026, 9, 13, 12);
const DAY = 24 * 60 * 60 * 1000;

function row(module: ModelModuleId, local: boolean, startedAt: number, bytesSent: number): CloudCallRecord {
  return {
    id: newId<'CloudCall'>(),
    module,
    provider: local ? 'on-device' : 'openai',
    model: local ? 'qwen3.5-4b' : 'gpt-5.5',
    reasoning: 'off',
    local,
    startedAt,
    latencyMs: 400,
    bytesSent,
    bytesReceived: 900,
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    costUsd: local ? 0 : 0.001,
    outcome: 'ok',
    attempt: 1,
  };
}

/** A month and a bit of calls: the older ones fall outside the 30-day window. */
const ROWS: CloudCallRecord[] = [
  row('agent', false, NOW - 1 * DAY, 12_000),
  row('agent', false, NOW - 3 * DAY, 8_000),
  row('agent', true, NOW - 2 * DAY, 5_000),
  row('vision', false, NOW - 5 * DAY, 400_000),
  row('vision', false, NOW - 29 * DAY, 300_000),
  row('vision', false, NOW - 31 * DAY, 999_999),
  row('embeddings', true, NOW - 1 * DAY, 2_000),
];

const PLANS: PrivacyModulePlan[] = [
  { module: 'agent', runsOn: 'both', providers: ['openai'], sends: ['messages', 'tool-results', 'prompts'] },
  { module: 'vision', runsOn: 'cloud', providers: ['openai', 'google'], sends: ['frames'] },
  { module: 'embeddings', runsOn: 'this-mac', providers: [], sends: [] },
  { module: 'voice', runsOn: 'off', providers: [], sends: [] },
];

function setup(rows: readonly CloudCallRecord[] = ROWS) {
  const settings = createMemorySettingsStore();
  const consents = createMemoryConsentStore();
  const asked: number[] = [];
  const service = createPrivacyService({
    settings,
    consents,
    cloudCalls: async (since) => {
      asked.push(since);
      // The store may hand back a little more than asked; the service counts only the window.
      return ok(rows);
    },
    modules: () => PLANS,
    lastAt: (flow) => (flow === 'update-checks' ? NOW - 3_600_000 : undefined),
    now: () => NOW,
  });
  return { settings, consents, service, asked };
}

/** What the panel must show for a module: the same aggregate a person would compute from Usage's rows. */
function expected(module: ModelModuleId) {
  const inWindow = ROWS.filter((r) => r.module === module && r.startedAt >= NOW - 30 * DAY);
  const cloud = inWindow.filter((r) => !r.local);
  return {
    calls: inWindow.length,
    cloudCalls: cloud.length,
    bytesSent: cloud.reduce((sum, r) => sum + r.bytesSent, 0),
    ...(cloud.length > 0 ? { lastCloudAt: Math.max(...cloud.map((r) => r.startedAt)) } : {}),
  };
}

describe('privacy overview', () => {
  it('counts each module from the CloudCall log, the same rows Usage shows', async () => {
    const { service, asked } = setup();
    const overview = unwrap(await service.overview());
    expect(privacyOverviewSchema.safeParse(overview).success).toBe(true);
    expect(asked).toEqual([NOW - 30 * DAY]);
    for (const plan of PLANS) {
      const shown = overview.modules.find((m) => m.module === plan.module)!;
      expect(shown.last30Days, plan.module).toEqual(expected(plan.module));
      expect(shown).toMatchObject({ runsOn: plan.runsOn, providers: plan.providers, sends: plan.sends });
    }
    expect(overview.modules.find((m) => m.module === 'vision')?.last30Days).toEqual({
      calls: 2,
      cloudCalls: 2,
      bytesSent: 700_000,
      lastCloudAt: NOW - 5 * DAY,
    });
    expect(overview.modules.find((m) => m.module === 'voice')?.last30Days).toEqual({
      calls: 0,
      cloudCalls: 0,
      bytesSent: 0,
    });
    expect(moduleTraffic([], 'agent')).toEqual({ calls: 0, cloudCalls: 0, bytesSent: 0 });
  });

  it('shows standing consents and the other network flows; Local only turns off all but downloads and updates', async () => {
    const { service, settings, consents } = setup();
    await consents.grant({ id: newId<'Consent'>(), module: 'vision', providers: ['openai'], grantedAt: 42 });
    unwrap(await settings.set(TELEMETRY_SETTING, { enabled: true, cohort: 'GOA26X', changedAt: 1 }));
    unwrap(await settings.set(CRASH_REPORTS_SETTING, { enabled: true, changedAt: 1 }));

    const before = unwrap(await service.overview());
    expect(before.localOnly).toBe(false);
    expect(before.switches).toEqual({ telemetry: true, crashReports: true, cohort: 'GOA26X' });
    expect(before.modules.find((m) => m.module === 'vision')?.consent).toEqual({
      module: 'vision',
      providers: ['openai'],
      grantedAt: 42,
    });
    expect(before.modules.find((m) => m.module === 'agent')?.consent).toBeNull();
    expect(before.other).toEqual([
      { flow: 'update-checks', enabled: true, allowedLocalOnly: true, lastAt: NOW - 3_600_000 },
      { flow: 'component-downloads', enabled: true, allowedLocalOnly: true },
      { flow: 'reference-links', enabled: true, allowedLocalOnly: false },
      { flow: 'telemetry', enabled: true, allowedLocalOnly: false },
      { flow: 'crash-reports', enabled: true, allowedLocalOnly: false },
      { flow: 'feedback', enabled: true, allowedLocalOnly: false },
      { flow: 'stock-media', enabled: true, allowedLocalOnly: false },
      { flow: 'template-hub', enabled: true, allowedLocalOnly: false },
    ]);
    expect(before.quality).toEqual([]);

    unwrap(await settings.set(LOCAL_ONLY_SETTING, true));
    const after = unwrap(await service.overview());
    expect(after.localOnly).toBe(true);
    expect(after.other.filter((o) => o.enabled).map((o) => o.flow)).toEqual([
      'update-checks',
      'component-downloads',
    ]);
    // The saved choices stay as the person set them while Local only pauses the flows.
    expect(after.switches).toEqual(before.switches);
  });

  it('a failing CloudCall read is an error value', async () => {
    const settings = createMemorySettingsStore();
    const service = createPrivacyService({
      settings,
      consents: createMemoryConsentStore(),
      cloudCalls: async () => err({ code: 'library.database_failed', messageKey: 'x', retryable: true }),
      modules: () => PLANS,
    });
    const failed = await service.overview();
    expect(!failed.ok && failed.error.code).toBe('library.database_failed');
  });
});

describe('privacy namespace', () => {
  it('serves the overview, and changed() yields the current state, then each change, until stopped', async () => {
    const { service, settings } = setup();
    const ports = channel();
    serveRpc(privacyRouter(service), ports.port1, { context: {} });
    const client = connectRpc(privacyContract, ports.port2, { peer: 'agent' }).client;

    expect((await client.overview()).modules).toHaveLength(PLANS.length);
    const controller = new AbortController();
    const stream = await client.changed(undefined, { signal: controller.signal });
    const first = await stream.next();
    expect((first.value as PrivacyOverview).localOnly).toBe(false);

    unwrap(await settings.set(LOCAL_ONLY_SETTING, true));
    service.notify();
    const second = await stream.next();
    expect((second.value as PrivacyOverview).localOnly).toBe(true);
    controller.abort();
    // Stopped: the stream ends (or the cancelled call rejects); either way nothing more arrives.
    const ended = await stream.next().then(
      (next) => next.done,
      () => true,
    );
    expect(ended).toBe(true);
  });

  it('changed() on the service itself ends when its signal aborts, and stops listening', async () => {
    const { service } = setup();
    const controller = new AbortController();
    const iterator = service.changed(controller.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    const pending = iterator.next();
    controller.abort();
    expect((await pending).done).toBe(true);
    service.notify(); // nobody listening: a no-op
  });

  it('a read that fails mid-stream reaches the window as a typed error', async () => {
    let fail = false;
    const service = createPrivacyService({
      settings: createMemorySettingsStore(),
      consents: createMemoryConsentStore(),
      cloudCalls: async () =>
        fail ? err({ code: 'library.database_failed', messageKey: 'x', retryable: true }) : ok([]),
      modules: () => [],
    });
    const ports = channel();
    serveRpc(privacyRouter(service), ports.port1, { context: {} });
    const client = connectRpc(privacyContract, ports.port2, { peer: 'agent' }).client;
    const stream = await client.changed();
    await stream.next();
    fail = true;
    service.notify();
    await expect(stream.next()).rejects.toMatchObject({ data: { code: 'library.database_failed' } });
  });
});
