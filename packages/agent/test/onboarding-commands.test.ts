// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B3's onboarding commands on core's real bus: where inside a step the person was (`branch`), how first
 * run ended (`via`), and "Run setup again" (`onboarding.reset`), which undo puts back exactly.
 */
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  ONBOARDING_COMMANDS,
  ONBOARDING_SETTING,
  unwrap,
} from '@taalcut/core';
import { createOnboardingCommands } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';

const ui = { source: 'ui', actor: 'user' } as const;
const agent = { source: 'agent', actor: 'agent:run' } as const;
const mcp = { source: 'mcp', actor: 'mcp:client' } as const;

function setup() {
  const clock = createManualClock(1_000);
  const settings = createMemorySettingsStore();
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  bus.register(...createOnboardingCommands({ settings, now: () => clock.now() }).all);
  return { clock, settings, bus };
}

describe('onboarding.setProgress (P3-B3)', () => {
  it('merges the branch into what is stored, so each step keeps its own part', async () => {
    const { bus, settings } = setup();
    unwrap(
      await bus.dispatch(
        ONBOARDING_COMMANDS.setProgress,
        { step: 'thinking', branch: { thinking: 'local-only' } },
        ui,
      ),
    );
    unwrap(
      await bus.dispatch(
        ONBOARDING_COMMANDS.setProgress,
        { step: 'sources', branch: { source: 'cable' } },
        ui,
      ),
    );
    unwrap(await bus.dispatch(ONBOARDING_COMMANDS.setProgress, { step: 'import' }, ui));
    expect(unwrap(await settings.get(ONBOARDING_SETTING)).branch).toEqual({
      thinking: 'local-only',
      source: 'cable',
    });
  });

  it('records a skip as skipped, and ignores `via` until onboarding is completed', async () => {
    const { bus, settings, clock } = setup();
    unwrap(await bus.dispatch(ONBOARDING_COMMANDS.setProgress, { step: 'thinking', via: 'skipped' }, ui));
    expect(unwrap(await settings.get(ONBOARDING_SETTING)).completedVia).toBeNull();
    clock.advance(5_000);
    unwrap(
      await bus.dispatch(
        ONBOARDING_COMMANDS.setProgress,
        { step: 'hardware', completed: true, via: 'skipped' },
        ui,
      ),
    );
    expect(unwrap(await settings.get(ONBOARDING_SETTING))).toMatchObject({
      step: 'hardware',
      startedAt: 1_000,
      completedAt: 6_000,
      completedVia: 'skipped',
    });
  });
});

describe('onboarding.reset (P3-B3)', () => {
  it('starts over, and undo puts the earlier progress back exactly; redo resets again', async () => {
    const { bus, settings, clock } = setup();
    unwrap(
      await bus.dispatch(
        ONBOARDING_COMMANDS.setProgress,
        { step: 'first-video', completed: true, branch: { thinking: 'api-key', starterPicker: true } },
        ui,
      ),
    );
    const before = unwrap(await settings.get(ONBOARDING_SETTING));
    clock.advance(86_400_000);
    unwrap(await bus.dispatch(ONBOARDING_COMMANDS.reset, {}, ui));
    expect(unwrap(await settings.get(ONBOARDING_SETTING))).toEqual(ONBOARDING_SETTING.defaultValue);

    expect(unwrap(await bus.undo(null, ui))).not.toBeNull();
    expect(unwrap(await settings.get(ONBOARDING_SETTING))).toEqual(before);
    expect(unwrap(await bus.redo(null, ui))).not.toBeNull();
    expect(unwrap(await settings.get(ONBOARDING_SETTING))).toEqual(ONBOARDING_SETTING.defaultValue);
  });

  it('is the person’s alone, and its restore is never dispatched by anyone', async () => {
    const { bus } = setup();
    for (const origin of [agent, mcp]) {
      const refused = await bus.dispatch(ONBOARDING_COMMANDS.reset, {}, origin);
      expect(refused.ok).toBe(false);
    }
    const restore = await bus.dispatch(ONBOARDING_COMMANDS.restore, ONBOARDING_SETTING.defaultValue, ui);
    expect(!restore.ok && restore.error.code).toBe('core.internal_command');
  });
});
