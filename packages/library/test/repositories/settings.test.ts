// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { unwrap, ValidationError, type CloudCallRecord } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRepositories } from '../../src/index';
import { cloudCall } from '../fixtures/records';
import { fakeClock, openTestDb } from '../helpers';

function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  return { db, clock, repos: createRepositories(db) };
}

describe('SettingsRepository', () => {
  it('stores JSON values and validates them on read', () => {
    const { repos } = setup();
    const theme = z.enum(['system', 'light', 'dark']);
    expect(unwrap(repos.settings.get('ui.theme', theme))).toBeUndefined();
    unwrap(repos.settings.set('ui.theme', 'dark'));
    expect(unwrap(repos.settings.get('ui.theme', theme))).toBe('dark');
    unwrap(repos.settings.set('ui.theme', 'neon'));
    const invalid = repos.settings.get('ui.theme', theme);
    expect(!invalid.ok && ValidationError.is(invalid.error)).toBe(true);
    unwrap(repos.settings.set('budget.monthlyUsd', { cap: 20 }));
    unwrap(repos.settings.set('ui.lastPanel', null));
    expect(repos.settings.all()).toEqual({
      'budget.monthlyUsd': { cap: 20 },
      'ui.lastPanel': null,
      'ui.theme': 'neon',
    });
    expect(unwrap(repos.settings.delete('ui.theme'))).toBe(true);
    expect(unwrap(repos.settings.delete('ui.theme'))).toBe(false);
  });

  it('rejects odd keys, values that are not plain JSON, and secrets', () => {
    const { repos } = setup();
    expect(repos.settings.set('Bad Key', 1).ok).toBe(false);
    expect(repos.settings.set('ok.key', undefined).ok).toBe(false);
    expect(repos.settings.set('ok.key', new Date()).ok).toBe(false);
    expect(repos.settings.set('ok.key', Number.POSITIVE_INFINITY).ok).toBe(false);
    const secret = repos.settings.set('models.openai', { apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz' });
    expect(!secret.ok && secret.error.detail).toMatch(/secret/);
    expect(repos.settings.set('big', 'x'.repeat(300_000)).ok).toBe(false);
  });

  it('does not echo a rejected key in the error (review 2: a token passed as a key)', () => {
    const { repos } = setup();
    const token = `sk-proj-${'A1b2C3d4'.repeat(5)}`;
    for (const key of [`Bearer ${token}`, token]) {
      const result = repos.settings.set(key, 1);
      expect(!result.ok && result.error.code).toBe('core.validation');
      expect(JSON.stringify(!result.ok && result.error)).not.toContain(token.slice(8));
    }
    expect(repos.settings.all()).toEqual({});
  });
});

describe('AcknowledgementRepository', () => {
  it('records once per terms version and shows the card again when terms change', () => {
    const { repos, clock } = setup();
    expect(repos.acknowledgements.has('login.claude', '2026-10')).toBe(false);
    const first = unwrap(
      repos.acknowledgements.record({
        featureId: 'login.claude',
        termsVersion: '2026-10',
        context: { provider: 'anthropic' },
      }),
    );
    expect(first).toMatchObject({ acknowledgedAt: clock.now(), context: { provider: 'anthropic' } });
    clock.advance(1000);
    expect(
      unwrap(repos.acknowledgements.record({ featureId: 'login.claude', termsVersion: '2026-10' })),
    ).toEqual(first);
    expect(repos.acknowledgements.has('login.claude', '2026-10')).toBe(true);
    expect(repos.acknowledgements.has('login.claude', '2027-01')).toBe(false);
    const newer = unwrap(
      repos.acknowledgements.record({ featureId: 'login.claude', termsVersion: '2027-01', at: 5 }),
    );
    expect(newer.acknowledgedAt).toBe(5);
    expect(repos.acknowledgements.latest('login.claude')?.id).toBe(first.id);
    expect(repos.acknowledgements.list()).toHaveLength(2);
    expect(repos.acknowledgements.record({ featureId: '', termsVersion: '1' }).ok).toBe(false);
    expect(repos.acknowledgements.record({ featureId: 'a', termsVersion: ' ' }).ok).toBe(false);
    expect(repos.acknowledgements.record({ featureId: 'a', termsVersion: '1', at: -1 }).ok).toBe(false);
    const leaky = repos.acknowledgements.record({
      featureId: 'a',
      termsVersion: '1',
      context: { token: 'Bearer abcdefghijklmnopqrstuvwxyz' },
    });
    expect(leaky.ok).toBe(false);
  });
});

describe('ModelProfileStateRepository', () => {
  it('keeps one opaque JSON document', () => {
    const { repos } = setup();
    expect(repos.modelProfileState.load()).toBeUndefined();
    unwrap(repos.modelProfileState.save({ active: 'balanced', profiles: [{ id: 'balanced' }] }));
    unwrap(repos.modelProfileState.save({ active: 'local', profiles: [] }));
    expect(repos.modelProfileState.load()).toEqual({ active: 'local', profiles: [] });
    unwrap(repos.modelProfileState.save(null));
    expect(repos.modelProfileState.load()).toBeNull();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(repos.modelProfileState.save(cyclic).ok).toBe(false);
    expect(repos.modelProfileState.save({ f: () => 1 }).ok).toBe(false);
    expect(repos.modelProfileState.save({ refresh_token: 'abc' }).ok).toBe(false);
  });
});

describe('CloudCallRepository', () => {
  it('stores core CloudCallRecords and totals them per module and provider', () => {
    const { repos } = setup();
    const t = Date.UTC(2026, 9, 12);
    const first = cloudCall({ latencyMs: 899.6, httpStatus: 200, runId: 'run-1', spanId: 'span-1' });
    unwrap(repos.cloudCalls.record(first));
    unwrap(
      repos.cloudCalls.record(
        cloudCall({
          startedAt: t + 1000,
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.0000004,
          bytesSent: 0,
        }),
      ),
    );
    unwrap(
      repos.cloudCalls.record(
        cloudCall({
          module: 'vision',
          provider: 'google',
          outcome: 'error',
          errorCode: 'models.rate_limited',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          bytesSent: 0,
          bytesReceived: 0,
          attempt: 2,
        }),
      ),
    );
    expect(repos.cloudCalls.totals()).toEqual([
      {
        module: 'agent',
        provider: 'openai',
        calls: 2,
        bytesSent: 4096,
        bytesReceived: 4096,
        inputTokens: 1010,
        outputTokens: 205,
        costMicroUsd: 12346,
      },
      {
        module: 'vision',
        provider: 'google',
        calls: 1,
        bytesSent: 0,
        bytesReceived: 0,
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
      },
    ]);
    // Read back: latency in whole ms, cost in micro-dollars.
    expect(repos.cloudCalls.list({ runId: 'run-1' })).toEqual([
      { ...first, latencyMs: 900, costUsd: 0.012346 },
    ]);
    expect(repos.cloudCalls.list({ module: 'agent' })).toHaveLength(2);
    expect(repos.cloudCalls.list({ since: t + 1 })).toHaveLength(1);
    expect(repos.cloudCalls.totals({ until: t + 1 })).toHaveLength(2);
  });

  it('writes exactly one row per call, even if the same record arrives twice', () => {
    const { repos } = setup();
    const call = cloudCall();
    expect(unwrap(repos.cloudCalls.record(call))).toEqual({ created: true });
    expect(unwrap(repos.cloudCalls.record(call))).toEqual({ created: false });
    expect(repos.cloudCalls.list()).toHaveLength(1);
  });

  it('rejects records that fail core’s schema', () => {
    const { repos } = setup();
    for (const bad of [
      { latencyMs: -1 },
      { costUsd: Number.NaN },
      { module: 'nonsense' },
      { attempt: 0 },
      { id: 'not-a-ulid' },
    ]) {
      const result = repos.cloudCalls.record(cloudCall(bad as Partial<CloudCallRecord>));
      expect(!result.ok && ValidationError.is(result.error)).toBe(true);
    }
  });
});
