// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings and model-profile writes made by a command commit with its audit
 * row: given the handler's context, ports.settings and ports.modelProfiles
 * stage through the unit of work instead of writing first.
 */
import {
  createCommandBus,
  defineCommand,
  defineSetting,
  ok,
  systemClock,
  unwrap,
  ValidationError,
  type CommandOrigin,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLibraryPorts, createRepositories } from '../../src/index';
import { openTestDb } from '../helpers';

const THEME = defineSetting('appearance.theme', z.enum(['system', 'light', 'dark']), 'system');
const ui: CommandOrigin = { source: 'ui', actor: 'user' };

function setup() {
  const db = openTestDb({ file: false });
  const ports = createLibraryPorts(db);
  const bus = createCommandBus({ store: ports.auditLog, clock: systemClock });
  const seen: string[] = [];
  const setTheme = defineCommand({
    name: 'settings.setTheme',
    payload: z.object({ preference: THEME.schema }),
    sideEffect: 'write',
    project: () => null,
    handle: ports.commands.handle(async ({ preference }, context) => {
      const before = unwrap(await ports.settings.get(THEME));
      const saved = await ports.settings.set(THEME, preference, context);
      if (!saved.ok) return saved;
      seen.push(unwrap(await ports.settings.get(THEME))); // still the old value: the write waits for append
      return ok({
        result: preference,
        inverse: { name: 'settings.setTheme', payload: { preference: before } },
      });
    }),
  });
  const saveProfiles = defineCommand({
    name: 'models.save',
    payload: z.object({ state: z.unknown() }),
    sideEffect: 'write',
    project: () => null,
    handle: ports.commands.handle(async ({ state }, context) => {
      const saved = await ports.modelProfiles.save(state, context);
      return saved.ok ? ok({ result: null }) : saved;
    }),
  });
  bus.register(setTheme, saveProfiles);
  return { db, ports, bus, seen, repos: createRepositories(db) };
}

describe('settings and model profiles staged with the command (P1-D5)', () => {
  it('writes a setting with its audit row, and undo goes through the same path', async () => {
    const { ports, bus, seen, repos } = setup();
    unwrap(await bus.dispatch('settings.setTheme', { preference: 'dark' }, ui));
    expect(seen).toEqual(['system']);
    expect(unwrap(await ports.settings.get(THEME))).toBe('dark');
    expect(unwrap(repos.auditLog.listByProject(null))).toMatchObject([{ name: 'settings.setTheme' }]);
    unwrap(await bus.undo(null, ui));
    expect(unwrap(await ports.settings.get(THEME))).toBe('system');
  });

  it('writes nothing when the audit row is refused', async () => {
    const { ports, bus, repos } = setup();
    // The audit log refuses an empty actor, so the command can't commit: neither can its setting.
    const refused = await bus.dispatch(
      'settings.setTheme',
      { preference: 'dark' },
      { source: 'ui', actor: '' },
    );
    expect(refused.ok).toBe(false);
    expect(unwrap(await ports.settings.get(THEME))).toBe('system');
    expect(repos.settings.all()).toEqual({});
    const profile = await bus.dispatch(
      'models.save',
      { state: { activeProfileId: 'p' } },
      { source: 'ui', actor: '' },
    );
    expect(profile.ok).toBe(false);
    expect(unwrap(await ports.modelProfiles.load())).toBeUndefined();
  });

  it('refuses a value it could never store before staging it, so the handler fails, not the commit', async () => {
    const { ports, bus } = setup();
    const secret = await bus.dispatch(
      'models.save',
      { state: { apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz' } },
      ui,
    );
    expect(!secret.ok && ValidationError.is(secret.error)).toBe(true);
    unwrap(await bus.dispatch('models.save', { state: { activeProfileId: 'balanced' } }, ui));
    expect(unwrap(await ports.modelProfiles.load())).toEqual({ activeProfileId: 'balanced' });
  });

  it('writes at once without a context (start-up, migrations)', async () => {
    const { ports } = setup();
    unwrap(await ports.settings.set(THEME, 'light'));
    expect(unwrap(await ports.settings.get(THEME))).toBe('light');
    unwrap(await ports.settings.reset(THEME));
    expect(unwrap(await ports.settings.get(THEME))).toBe('system');
    unwrap(await ports.modelProfiles.save({ activeProfileId: 'x' }));
    expect(unwrap(await ports.modelProfiles.load())).toEqual({ activeProfileId: 'x' });
  });
});
