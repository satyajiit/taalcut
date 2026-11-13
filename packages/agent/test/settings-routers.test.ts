// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's Phase 2 namespaces over a port, as a window calls them: budget
 * (a project's cap and spend, the default cap), onboarding, telemetry (a
 * window records only its own events) and telemetryIngest (any catalogue
 * event from another process).
 */
import {
  budgetContract,
  connectRpc,
  createMemorySettingsStore,
  newId,
  ONBOARDING_SETTING,
  onboardingContract,
  serveRpc,
  TELEMETRY_SETTING,
  telemetryContract,
  telemetryIngestContract,
  unwrap,
  type ProjectId,
  type Telemetry,
  type TelemetryEvent,
} from '@taalcut/core';
import {
  budgetRouter,
  createBudgetService,
  onboardingRouter,
  settingsTelemetryState,
  telemetryIngestRouter,
  telemetryRouter,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { channel, fakeBudgetStore, usd } from './support/ports';

function recordingTelemetry() {
  const recorded: { event: TelemetryEvent; projectId?: ProjectId }[] = [];
  const telemetry: Telemetry = {
    record(event, context) {
      recorded.push({ event, ...(context?.projectId ? { projectId: context.projectId } : {}) });
    },
  };
  return { telemetry, recorded };
}

describe('budget namespace', () => {
  it("reads a project's cap and spend, and the default cap", async () => {
    const settings = createMemorySettingsStore();
    const projectId = newId<'Project'>();
    const budgets = fakeBudgetStore({ [projectId]: { cap: usd(2), spent: usd(1.25) } });
    const ports = channel();
    serveRpc(budgetRouter(createBudgetService({ budgets, settings })), ports.port1, { context: {} });
    const client = connectRpc(budgetContract, ports.port2, { peer: 'agent' }).client;

    expect(await client.project({ projectId })).toEqual({ projectId, cap: usd(2), spent: usd(1.25) });
    expect(await client.defaults()).toEqual({ projectCap: usd(2) });
    await expect(client.project({ projectId: newId<'Project'>() })).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
  });
});

describe('onboarding namespace', () => {
  it('reads the stored progress', async () => {
    const settings = createMemorySettingsStore();
    const ports = channel();
    serveRpc(onboardingRouter(settings), ports.port1, { context: {} });
    const client = connectRpc(onboardingContract, ports.port2, { peer: 'agent' }).client;
    const unstarted = { branch: {}, completedVia: null };
    expect(await client.state()).toEqual({ step: null, startedAt: null, completedAt: null, ...unstarted });
    const progress = { step: 'hardware', startedAt: 5, completedAt: null, ...unstarted } as const;
    unwrap(await settings.set(ONBOARDING_SETTING, progress));
    expect(await client.state()).toEqual(progress);
  });
});

describe('telemetry namespaces', () => {
  it("serves the state from the setting and the queue, and records a window's own events", async () => {
    const settings = createMemorySettingsStore();
    unwrap(await settings.set(TELEMETRY_SETTING, { enabled: true, cohort: 'XYZ789', changedAt: 3 }));
    const { telemetry, recorded } = recordingTelemetry();
    const ports = channel();
    const state = settingsTelemetryState(settings, () => ({ queued: 7, lastSentAt: 99 }));
    serveRpc(telemetryRouter({ telemetry, state }), ports.port1, { context: {} });
    const client = connectRpc(telemetryContract, ports.port2, { peer: 'agent' }).client;

    expect(await client.state()).toEqual({ enabled: true, cohort: 'XYZ789', queued: 7, lastSentAt: 99 });
    const projectId = newId<'Project'>();
    await client.record({ event: { name: 'export.survey', answer: 'yes' }, projectId });
    await client.record({ event: { name: 'onboarding.step', step: 'alpha', ms: 1200, skipped: false } });
    expect(recorded).toEqual([
      { event: { name: 'export.survey', answer: 'yes' }, projectId },
      { event: { name: 'onboarding.step', step: 'alpha', ms: 1200, skipped: false } },
    ]);

    // A window can't record what only the agent and main see.
    await expect(client.record({ event: { name: 'flow.started', path: 'describe' } })).rejects.toMatchObject({
      data: { code: 'core.validation' },
    });
    expect(recorded).toHaveLength(2);
  });

  it('without a queue the state shows nothing queued; off stays off', async () => {
    const settings = createMemorySettingsStore();
    expect(unwrap(await settingsTelemetryState(settings)())).toEqual({ enabled: false, queued: 0 });
  });

  it('ingest records any catalogue event from another process, and refuses one with text in it', async () => {
    const { telemetry, recorded } = recordingTelemetry();
    const ports = channel();
    serveRpc(telemetryIngestRouter(telemetry), ports.port1, { context: {} });
    const client = connectRpc(telemetryIngestContract, ports.port2, { peer: 'main' }).client;
    await client.record({ event: { name: 'flow.started', path: 'reference' } });
    await client.record({
      event: {
        name: 'import.completed',
        source: 'wifi',
        assets: '21-100',
        failed: '0',
        reencodedByPhone: '1',
        ms: 4000,
      },
    });
    expect(recorded.map((r) => r.event.name)).toEqual(['flow.started', 'import.completed']);
    await expect(
      client.record({ event: { name: 'flow.started', path: 'reference', note: 'goa trip' } as never }),
    ).rejects.toMatchObject({ data: { code: 'core.validation' } });
    expect(recorded).toHaveLength(2);
  });
});
