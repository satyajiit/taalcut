// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * STYLE_COMMANDS (P3-V10) on core's bus. Styles are app-wide. Update names the revision it read; a stale one
 * is core.conflict. Delete is destructive and refused while anything still uses the Style. Create's inverse
 * is delete; update and delete restore the previous document; rename and setDefault invert themselves. Every
 * write passes the command's context, so it commits with the audit row or not at all.
 */
import {
  ConflictError,
  DEFAULT_STYLE_SETTING,
  defineCommand,
  err,
  NotFoundError,
  ok,
  STYLE_COMMANDS,
  styleCommandPayloads,
  styleProblems,
  styleSchema,
  ValidationError,
  type AnyCommand,
  type Clock,
  type SettingsStore,
  type Style,
  type StyleId,
  type StyleStore,
} from '@taalcut/core';
import { StyleInUse, StyleNotFound } from '../errors';
import { applyStylePatch } from './style-patch';

const N = STYLE_COMMANDS;
const P = styleCommandPayloads;

export interface StyleCommandDeps {
  readonly store: StyleStore;
  readonly settings: SettingsStore;
  readonly clock: Clock;
}

export function createStyleCommands({ store, settings, clock }: StyleCommandDeps) {
  async function load(styleId: StyleId) {
    const found = await store.get(styleId);
    if (found.ok) return ok(found.value);
    return NotFoundError.is(found.error) ? err(StyleNotFound()) : found;
  }

  const create = defineCommand({
    name: N.create,
    payload: P[N.create],
    sideEffect: 'write',
    handle: async ({ styleId, style }, context) => {
      const problem = styleProblems(style)[0];
      if (problem) return err(ValidationError({ field: 'style' }, { detail: problem }));
      const now = clock.now();
      const parsed = styleSchema.safeParse({
        schemaVersion: 1,
        id: styleId,
        revision: 1,
        ...style,
        createdAt: now,
        updatedAt: now,
      });
      if (!parsed.success)
        return err(ValidationError({ field: 'style' }, { detail: parsed.error.issues[0]?.message }));
      const stored = await store.create(parsed.data, context);
      if (!stored.ok) return stored;
      return ok({
        result: { styleId, revision: 1 },
        inverse: { name: N.remove, payload: { projectId: null, styleId } },
      });
    },
  });

  const update = defineCommand({
    name: N.update,
    payload: P[N.update],
    sideEffect: 'write',
    handle: async ({ styleId, baseRevision, patch }, context) => {
      const current = await load(styleId);
      if (!current.ok) return current;
      if (current.value.revision !== baseRevision)
        return err(ConflictError({ entity: 'style', id: styleId }));
      const patched = applyStylePatch(current.value, patch);
      if (!patched.ok) return patched;
      const next = styleSchema.safeParse({
        ...patched.value,
        revision: current.value.revision + 1,
        updatedAt: clock.now(),
      });
      if (!next.success) return err(ValidationError({ field: 'style' }));
      const stored = await store.put(next.data, baseRevision, context);
      if (!stored.ok) return stored;
      return ok({
        result: { styleId, revision: next.data.revision },
        inverse: { name: N.restore, payload: { projectId: null, styleId, style: current.value } },
      });
    },
  });

  const rename = defineCommand({
    name: N.rename,
    payload: P[N.rename],
    sideEffect: 'write',
    handle: async ({ styleId, name }, context) => {
      const current = await load(styleId);
      if (!current.ok) return current;
      const next: Style = {
        ...current.value,
        name,
        revision: current.value.revision + 1,
        updatedAt: clock.now(),
      };
      const stored = await store.put(next, current.value.revision, context);
      if (!stored.ok) return stored;
      return ok({
        result: { styleId, name },
        inverse: { name: N.rename, payload: { projectId: null, styleId, name: current.value.name } },
      });
    },
  });

  const remove = defineCommand({
    name: N.remove,
    payload: P[N.remove],
    sideEffect: 'destructive',
    handle: async ({ styleId }, context) => {
      const current = await load(styleId);
      if (!current.ok) return current;
      const usage = await store.usedBy(styleId);
      if (!usage.ok) return usage;
      if (usage.value.timelines > 0 || usage.value.templates > 0)
        return err(StyleInUse({ timelines: usage.value.timelines, templates: usage.value.templates }));
      const removed = await store.remove(styleId, context);
      if (!removed.ok) return removed;
      return ok({
        result: { styleId },
        inverse: { name: N.restore, payload: { projectId: null, styleId, style: current.value } },
      });
    },
  });

  const setDefault = defineCommand({
    name: N.setDefault,
    payload: P[N.setDefault],
    sideEffect: 'write',
    handle: async ({ styleId }, context) => {
      if (styleId !== null) {
        const current = await load(styleId);
        if (!current.ok) return current;
      }
      const previous = await settings.get(DEFAULT_STYLE_SETTING);
      if (!previous.ok) return previous;
      const saved = await settings.set(DEFAULT_STYLE_SETTING, styleId, context);
      if (!saved.ok) return saved;
      return ok({
        result: { styleId },
        inverse: { name: N.setDefault, payload: { projectId: null, styleId: previous.value } },
      });
    },
  });

  const restore = defineCommand({
    name: N.restore,
    payload: P[N.restore],
    sideEffect: 'write',
    internal: true,
    handle: async ({ styleId, style }, context) => {
      const current = await store.get(styleId);
      if (style === null) {
        if (!current.ok) return NotFoundError.is(current.error) ? ok({ result: { styleId } }) : current;
        const removed = await store.remove(styleId, context);
        return removed.ok ? ok({ result: { styleId } }) : removed;
      }
      if (style.id !== styleId) return err(ValidationError({ field: 'styleId' }));
      if (!current.ok) {
        if (!NotFoundError.is(current.error)) return current;
        const created = await store.create(style, context);
        return created.ok ? ok({ result: { styleId, revision: style.revision } }) : created;
      }
      const stored = await store.put(style, current.value.revision, context);
      return stored.ok ? ok({ result: { styleId, revision: style.revision } }) : stored;
    },
  });

  const all: AnyCommand[] = [create, update, rename, remove, setDefault, restore];
  return { create, update, rename, remove, setDefault, restore, all };
}

export type StyleCommands = ReturnType<typeof createStyleCommands>;
