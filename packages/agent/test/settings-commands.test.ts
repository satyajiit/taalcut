// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The commands the agent process handles for Phase 2 (core SPEC section 13),
 * on core's real command bus: the budget caps (person-only, undoable), the
 * privacy switches and onboarding progress (person-only, never undone), and
 * the download of everything this Mac needs.
 */
import {
  BUDGET_COMMANDS,
  COMPONENT_COMMANDS,
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  CRASH_REPORTS_SETTING,
  DEFAULT_PROJECT_CAP_SETTING,
  err,
  LOCAL_ONLY_SETTING,
  newId,
  ok,
  ONBOARDING_COMMANDS,
  ONBOARDING_SETTING,
  PRIVACY_COMMANDS,
  TELEMETRY_SETTING,
  unwrap,
  type AsyncResult,
  type ComponentDownloadsPort,
  type Downloads,
} from '@taalcut/core';
import {
  createBudgetCommands,
  createComponentCommands,
  createOnboardingCommands,
  createPrivacyCommands,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { fakeBudgetStore, usd } from './support/ports';

const ui = { source: 'ui', actor: 'user' } as const;
const agent = { source: 'agent', actor: 'agent:run' } as const;
const mcp = { source: 'mcp', actor: 'mcp:client' } as const;

function setup() {
  const clock = createManualClock(1_000);
  const settings = createMemorySettingsStore();
  const projectId = newId<'Project'>();
  const budgets = fakeBudgetStore({ [projectId]: { cap: usd(2), spent: usd(0.4) } });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  bus.register(
    ...createBudgetCommands({ budgets, settings }).all,
    ...createPrivacyCommands({ settings, now: () => clock.now() }).all,
    ...createOnboardingCommands({ settings, now: () => clock.now() }).all,
  );
  return { clock, settings, projectId, budgets, bus };
}

describe('budget commands', () => {
  it('raise a project cap from the UI; undo and redo put it back and forth', async () => {
    const { bus, projectId, budgets } = setup();
    const receipt = unwrap(await bus.dispatch(BUDGET_COMMANDS.setProjectCap, { projectId, cap: usd(5) }, ui));
    expect(receipt).toMatchObject({ projectId, undoable: true, result: { projectId, cap: usd(5) } });
    expect(unwrap(await budgets.get(projectId)).cap).toEqual(usd(5));

    expect(unwrap(await bus.undo(projectId, ui))?.name).toBe(BUDGET_COMMANDS.setProjectCap);
    expect(unwrap(await budgets.get(projectId)).cap).toEqual(usd(2));
    await bus.redo(projectId, ui);
    expect(unwrap(await budgets.get(projectId)).cap).toEqual(usd(5));

    // No cap at all is the user's choice too.
    unwrap(await bus.dispatch(BUDGET_COMMANDS.setProjectCap, { projectId, cap: null }, ui));
    expect(unwrap(await budgets.get(projectId)).cap).toBeNull();
  });

  it('refuse the agent and MCP clients, on dispatch and on undo', async () => {
    const { bus, projectId, budgets } = setup();
    for (const origin of [agent, mcp]) {
      const refused = await bus.dispatch(BUDGET_COMMANDS.setProjectCap, { projectId, cap: usd(50) }, origin);
      expect(!refused.ok && refused.error).toMatchObject({
        code: 'core.command_source_refused',
        params: { name: BUDGET_COMMANDS.setProjectCap, source: origin.source },
      });
    }
    expect(budgets.writes).toEqual([]);
    unwrap(await bus.dispatch(BUDGET_COMMANDS.setProjectCap, { projectId, cap: usd(3) }, ui));
    const undo = await bus.undo(projectId, agent);
    expect(!undo.ok && undo.error.code).toBe('core.command_source_refused');
  });

  it('an unknown project fails as the store says and changes nothing', async () => {
    const { bus, budgets } = setup();
    const failed = await bus.dispatch(
      BUDGET_COMMANDS.setProjectCap,
      { projectId: newId<'Project'>(), cap: usd(1) },
      ui,
    );
    expect(!failed.ok && failed.error.code).toBe('core.not_found');
    expect(budgets.writes).toEqual([]);
  });

  it('the default cap starts at US$2.00 and is app-wide and undoable', async () => {
    const { bus, settings } = setup();
    expect(unwrap(await settings.get(DEFAULT_PROJECT_CAP_SETTING))).toEqual(usd(2));
    const receipt = unwrap(await bus.dispatch(BUDGET_COMMANDS.setDefaultCap, { cap: usd(1.5) }, ui));
    expect(receipt).toMatchObject({ projectId: null, undoable: true });
    expect(unwrap(await settings.get(DEFAULT_PROJECT_CAP_SETTING))).toEqual(usd(1.5));
    await bus.undo(null, ui);
    expect(unwrap(await settings.get(DEFAULT_PROJECT_CAP_SETTING))).toEqual(usd(2));
    const refused = await bus.dispatch(BUDGET_COMMANDS.setDefaultCap, { cap: null }, agent);
    expect(!refused.ok && refused.error.code).toBe('core.command_source_refused');
  });
});

describe('privacy switches', () => {
  it('are written, audited and never undone; only a person may flip them', async () => {
    const { bus, settings, clock } = setup();
    clock.advance(500);
    const local = unwrap(await bus.dispatch(PRIVACY_COMMANDS.setLocalOnly, { enabled: true }, ui));
    expect(local).toMatchObject({ projectId: null, undoable: false, result: { enabled: true } });
    expect(unwrap(await settings.get(LOCAL_ONLY_SETTING))).toBe(true);

    unwrap(await bus.dispatch(PRIVACY_COMMANDS.setTelemetry, { enabled: true, cohort: 'ABC123' }, ui));
    expect(unwrap(await settings.get(TELEMETRY_SETTING))).toEqual({
      enabled: true,
      cohort: 'ABC123',
      changedAt: 1_500,
    });
    clock.advance(10);
    // Turning it off keeps the cohort code with the install.
    unwrap(await bus.dispatch(PRIVACY_COMMANDS.setTelemetry, { enabled: false }, ui));
    expect(unwrap(await settings.get(TELEMETRY_SETTING))).toEqual({
      enabled: false,
      cohort: 'ABC123',
      changedAt: 1_510,
    });

    unwrap(
      await bus.dispatch(
        PRIVACY_COMMANDS.setCrashReports,
        { enabled: true },
        { source: 'shortcut', actor: 'user' },
      ),
    );
    expect(unwrap(await settings.get(CRASH_REPORTS_SETTING))).toEqual({ enabled: true, changedAt: 1_510 });

    // ⌘Z never turns a privacy switch back.
    expect(unwrap(await bus.history(null))).toEqual({ undo: null, redo: null });
    expect(unwrap(await bus.undo(null, ui))).toBeNull();
    expect(unwrap(await settings.get(LOCAL_ONLY_SETTING))).toBe(true);

    for (const name of Object.values(PRIVACY_COMMANDS)) {
      const refused = await bus.dispatch(name, { enabled: false }, agent);
      expect(!refused.ok && refused.error.code, name).toBe('core.command_source_refused');
    }
    expect(unwrap(await settings.get(LOCAL_ONLY_SETTING))).toBe(true);
  });

  it('refuse a malformed cohort code', async () => {
    const { bus } = setup();
    const bad = await bus.dispatch(PRIVACY_COMMANDS.setTelemetry, { enabled: true, cohort: 'abc' }, ui);
    expect(!bad.ok && bad.error.code).toBe('core.validation');
  });
});

describe('onboarding progress', () => {
  it('keeps the first start time, marks completion and is never undone', async () => {
    const { bus, settings, clock } = setup();
    expect(unwrap(await settings.get(ONBOARDING_SETTING))).toEqual({
      step: null,
      startedAt: null,
      completedAt: null,
      branch: {},
      completedVia: null,
    });
    unwrap(await bus.dispatch(ONBOARDING_COMMANDS.setProgress, { step: 'thinking' }, ui));
    clock.advance(60_000);
    unwrap(await bus.dispatch(ONBOARDING_COMMANDS.setProgress, { step: 'sources' }, ui));
    expect(unwrap(await settings.get(ONBOARDING_SETTING))).toEqual({
      step: 'sources',
      startedAt: 1_000,
      completedAt: null,
      branch: {},
      completedVia: null,
    });
    clock.advance(1_000);
    unwrap(await bus.dispatch(ONBOARDING_COMMANDS.setProgress, { step: 'first-video', completed: true }, ui));
    expect(unwrap(await settings.get(ONBOARDING_SETTING))).toEqual({
      step: 'first-video',
      startedAt: 1_000,
      completedAt: 62_000,
      branch: {},
      // Completed without saying how: it was finished, not skipped.
      completedVia: 'finished',
    });
    expect(unwrap(await bus.history(null)).undo).toBeNull();
    const refused = await bus.dispatch(ONBOARDING_COMMANDS.setProgress, { step: 'alpha' }, agent);
    expect(!refused.ok && refused.error.code).toBe('core.command_source_refused');
  });
});

describe('the download of everything this Mac needs (UX2-DOWNLOADER)', () => {
  function port(answer: (call: string) => AsyncResult<Downloads>) {
    const asked: string[] = [];
    const downloads: ComponentDownloadsPort = {
      status: () => answer('status'),
      start: (options = {}) => {
        asked.push(`start:${options.first?.join(',') ?? ''}`);
        return answer('start');
      },
      pause: () => {
        asked.push('pause');
        return answer('pause');
      },
      cancel: () => {
        asked.push('cancel');
        return answer('cancel');
      },
    };
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock() });
    bus.register(...createComponentCommands({ downloads }).all);
    return { bus, asked };
  }
  const state = (value: Downloads['state']): Downloads => ({
    state: value,
    components: [],
    counts: { installed: 0, downloading: 0, queued: 0, paused: 0, failed: 0, missing: 0 },
    bytesTotal: 0,
    bytesDone: 0,
    bytesPerSecond: 0,
    requiredBytes: 0,
  });

  it('starts it with what goes first, and answers with the state it left it in; no undo', async () => {
    const { bus, asked } = port(async () => ok(state('downloading')));
    const receipt = unwrap(await bus.dispatch(COMPONENT_COMMANDS.download, { first: ['whisper-tiny'] }, ui));
    expect(receipt).toMatchObject({ projectId: null, undoable: false, result: { state: 'downloading' } });
    unwrap(await bus.dispatch(COMPONENT_COMMANDS.download, {}, ui));
    expect(asked).toEqual(['start:whisper-tiny', 'start:']);
  });

  it('pauses, resumes and cancels', async () => {
    const { bus, asked } = port(async (call) => ok(state(call === 'pause' ? 'paused' : 'missing')));
    expect(unwrap(await bus.dispatch(COMPONENT_COMMANDS.pauseDownloads, {}, ui)).result).toEqual({
      state: 'paused',
    });
    unwrap(await bus.dispatch(COMPONENT_COMMANDS.resumeDownloads, {}, ui));
    unwrap(await bus.dispatch(COMPONENT_COMMANDS.cancelDownloads, {}, ui));
    expect(asked).toEqual(['pause', 'start:', 'cancel']);
  });

  it('returns why it could not start (not enough space), and a component named twice is refused first', async () => {
    const low = {
      code: 'jobs.downloads_space_low',
      messageKey: 'errors.jobs.downloads_space_low',
      retryable: false,
      params: { requiredBytes: 9, availableBytes: 1 },
    };
    const { bus, asked } = port(async () => err(low));
    const failed = await bus.dispatch(COMPONENT_COMMANDS.download, {}, ui);
    expect(!failed.ok && failed.error).toMatchObject({ code: 'jobs.downloads_space_low' });
    const twice = await bus.dispatch(COMPONENT_COMMANDS.download, { first: ['a', 'a'] }, ui);
    expect(!twice.ok && twice.error.code).toBe('core.validation');
    expect(asked).toEqual(['start:']);
  });
});
