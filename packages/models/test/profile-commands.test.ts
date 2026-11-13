// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Model settings commands commit with their audit row: each handler passes
 * its command context through ModelProfiles to ModelProfileStore.save, and a
 * store that stages by context (as packages/library's unit of work does)
 * writes the profile only when the bus records the step. A command that
 * fails to record leaves the profile as it was, in the store and in memory.
 */
import {
  createCommandBus,
  createMemoryAuditLogStore,
  defineError,
  err,
  ok,
  systemClock,
  type AuditLogStore,
  type CommandContext,
  type CommandId,
  type ModelProfileStore,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createModelProfiles, createModelSettingsService, createModelRuntime } from '@taalcut/models';

const USER = { source: 'ui', actor: 'user' } as const;
/** The audit change of a step failed to commit (a full disk, say). */
const AuditFailed = defineError('test.audit_failed');

/**
 * Library's unit of work in miniature: a save with a context waits for the audit change of its
 * step and commits with it; when that change fails, the step's writes and its rollback's are dropped.
 */
function createStagedProfiles() {
  const events: string[] = [];
  // Keyed by the step's command id; undo and redo reuse it with a fresh context.
  const pending = new Map<CommandId, { context: CommandContext; state: unknown }>();
  const settled = new WeakSet<CommandContext>();
  let stored: unknown;
  let failNext = false;

  const commit = (id: CommandId, recorded: boolean) => {
    const step = pending.get(id);
    pending.delete(id);
    if (!step) return;
    settled.add(step.context);
    if (recorded) {
      stored = step.state;
      events.push('write');
    }
  };
  const store: ModelProfileStore = {
    load: async () => ok(stored === undefined ? undefined : structuredClone(stored)),
    async save(state: unknown, context?: CommandContext) {
      if (!context) {
        stored = structuredClone(state);
        events.push('write');
      } else if (!settled.has(context)) {
        pending.set(context.commandId, { context, state: structuredClone(state) });
        events.push('stage');
      }
      return ok(undefined);
    },
  };
  const memory = createMemoryAuditLogStore();
  const audit: AuditLogStore = {
    ...memory,
    async append(entry) {
      if (failNext) {
        failNext = false;
        commit(entry.id, false);
        return err(AuditFailed());
      }
      const appended = await memory.append(entry);
      events.push('append');
      commit(entry.id, appended.ok);
      return appended;
    },
    async markUndone(change) {
      const marked = await memory.markUndone(change);
      commit(change.id, marked.ok);
      return marked;
    },
  };
  return {
    store,
    audit,
    events,
    stored: () => stored as { activeProfileId?: string } | undefined,
    failNextAppend: () => (failNext = true),
  };
}

function setup() {
  const staged = createStagedProfiles();
  const profiles = createModelProfiles({ store: staged.store });
  const settings = createModelSettingsService({ profiles, runtime: createModelRuntime() });
  const bus = createCommandBus({ store: staged.audit, clock: systemClock });
  bus.register(...settings.commands);
  return { ...staged, profiles, settings, bus };
}

describe('model settings commands and their audit row', () => {
  it('writes the profile in the same step as the audit row, for the command and its undo', async () => {
    const { bus, profiles, events, stored } = setup();
    expect(await bus.dispatch('models.setProfile', { profileId: 'fast-cheap' }, USER)).toMatchObject({
      ok: true,
    });
    expect(events).toEqual(['stage', 'append', 'write']);
    expect(stored()?.activeProfileId).toBe('fast-cheap');
    expect(profiles.state().activeProfileId).toBe('fast-cheap');

    expect(await bus.undo(null, USER)).toMatchObject({ ok: true });
    expect(stored()?.activeProfileId).toBe('balanced');
    expect(profiles.state().activeProfileId).toBe('balanced');
  });

  it('leaves the profile unchanged, saved and in memory, when the command fails to record', async () => {
    const { bus, profiles, settings, stored, failNextAppend } = setup();
    const before = settings.settings();
    failNextAppend();
    expect(
      await bus.dispatch(
        'models.setModuleOverride',
        { module: 'agent', override: { primary: { provider: 'anthropic', model: 'claude-sonnet-5-5' } } },
        USER,
      ),
    ).toMatchObject({ ok: false, error: { code: 'test.audit_failed' } });
    expect(stored()).toBeUndefined();
    expect(profiles.state().overrides).toEqual({});
    expect(settings.settings()).toEqual(before);
    // Nothing was recorded, so there is nothing to undo.
    expect(await bus.undo(null, USER)).toEqual(ok(null));
  });
});
