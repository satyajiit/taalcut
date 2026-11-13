// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Soul v1 in the agent process (packages/agent SPEC section 22): the bundled SOUL.md is read strictly, so a
 * broken file stops composition instead of running the agent without its persona; the dial command and tool
 * that agent-launch.ts adds.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_SETTING_COMMANDS,
  ClockToken,
  createCommandBus,
  createContainer,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  SettingsStoreToken,
  SOUL_DIALS_SETTING,
  unwrap,
} from '@taalcut/core';
import { registerSoul, soulCommands, SoulToken, soulToolModules } from '../src/utility/roots/agent-soul';

const SOUL = readFileSync(join(import.meta.dirname, '..', '..', '..', 'SOUL.md'), 'utf8');

function container() {
  const settings = createMemorySettingsStore();
  const root = createContainer().value(ClockToken, createManualClock(0)).value(SettingsStoreToken, settings);
  return { root, settings };
}

describe('the soul in the agent process', () => {
  it('registers the bundled SOUL.md with its dial stops', () => {
    const { root } = container();
    registerSoul(root, SOUL);
    const soul = root.resolve(SoulToken);
    expect(soul.version).toBe('1.0.0');
    expect(soul.stops?.tone).toHaveLength(5);
  });

  it('refuses a SOUL.md without a version: the agent never runs without its persona', () => {
    const { root } = container();
    expect(() => registerSoul(root, SOUL.replace(/^version: .*$/m, ''))).toThrow(/agent\.soul_invalid/);
  });

  it('adds the dial tool and the command that writes the setting', async () => {
    const { root, settings } = container();
    registerSoul(root, SOUL);
    expect(soulToolModules(root).flatMap((m) => m.tools.map((t) => t.name))).toContain('soul.setDials');
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(0) });
    bus.register(...soulCommands(root));
    unwrap(
      await bus.dispatch(AGENT_SETTING_COMMANDS.setSoulDials, { tone: 0 }, { source: 'ui', actor: 'user' }),
    );
    expect(unwrap(await settings.get(SOUL_DIALS_SETTING))).toEqual({ tone: 0, verbosity: 1 });
  });
});
