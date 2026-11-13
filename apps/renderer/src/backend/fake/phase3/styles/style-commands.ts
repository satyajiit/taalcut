// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- error details as the real handlers write them (logs): never shown as words */

/**
 * STYLE_COMMANDS as @taalcut/templates handles them (src/styles/style-commands.ts, style-patch.ts): app-wide
 * (`projectId: null`); update names the revision it read (core.conflict otherwise) and checks the patched Style
 * with core's styleSchema and styleProblems; delete is refused while anything names the Style
 * (`templates.style_in_use`); create's inverse is delete, update's and delete's restore the previous document,
 * rename and setDefault invert themselves.
 */
import {
  ConflictError,
  DEFAULT_STYLE_SETTING,
  defineCommand,
  err,
  ok,
  STYLE_COMMANDS,
  styleCommandPayloads,
  styleProblems,
  styleSchema,
  ValidationError,
  type AnyCommand,
  type Result,
  type SettingsStore,
  type Style,
  type StyleInput,
} from '@taalcut/core';
import { styleInUse } from './style-errors';
import type { StyleState } from './style-state';

const N = STYLE_COMMANDS;
const P = styleCommandPayloads;

/** templates' applyStylePatch: any field but id and kind, checked as a whole Style. */
export function applyStylePatch(style: Style, patch: Partial<Omit<StyleInput, 'kind'>>): Result<Style> {
  if (Object.keys(patch).length === 0)
    return err(ValidationError({ field: 'patch' }, { detail: 'Nothing to change' }));
  const parsed = styleSchema.safeParse({ ...style, ...patch, id: style.id, kind: style.kind });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.map(String).join('.') || 'style';
    return err(ValidationError({ field }, { detail: parsed.error.issues[0]?.message ?? 'Invalid style' }));
  }
  const problem = styleProblems(parsed.data)[0];
  if (problem) return err(ValidationError({ field: 'style' }, { detail: problem }));
  return ok(parsed.data);
}

export function createStyleCommands(
  store: StyleState,
  deps: { readonly settings: SettingsStore; readonly now: () => number },
): AnyCommand[] {
  const create = defineCommand({
    name: N.create,
    payload: P[N.create],
    sideEffect: 'write',
    handle: ({ styleId, style }) => {
      const problem = styleProblems(style)[0];
      if (problem) return err(ValidationError({ field: 'style' }, { detail: problem }));
      const now = deps.now();
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
      const stored = store.create(parsed.data);
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
    handle: ({ styleId, baseRevision, patch }) => {
      const current = store.get(styleId);
      if (!current.ok) return current;
      // A stale baseRevision: someone (the agent, another window) saved since it was read.
      if (current.value.revision !== baseRevision)
        return err(ConflictError({ entity: 'style', id: styleId }));
      const patched = applyStylePatch(current.value, patch);
      if (!patched.ok) return patched;
      const next = styleSchema.safeParse({
        ...patched.value,
        revision: current.value.revision + 1,
        updatedAt: deps.now(),
      });
      if (!next.success) return err(ValidationError({ field: 'style' }));
      const stored = store.put(next.data, baseRevision);
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
    handle: ({ styleId, name }) => {
      const current = store.get(styleId);
      if (!current.ok) return current;
      const next: Style = {
        ...current.value,
        name,
        revision: current.value.revision + 1,
        updatedAt: deps.now(),
      };
      const stored = store.put(next, current.value.revision);
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
    handle: async ({ styleId }) => {
      const current = store.get(styleId);
      if (!current.ok) return current;
      const usage = await store.usedBy(styleId);
      if (!usage.ok) return usage;
      if (usage.value.timelines > 0 || usage.value.templates > 0) return err(styleInUse(usage.value));
      store.remove(styleId);
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
    handle: async ({ styleId }) => {
      if (styleId !== null) {
        const current = store.get(styleId);
        if (!current.ok) return current;
      }
      const previous = await deps.settings.get(DEFAULT_STYLE_SETTING);
      if (!previous.ok) return previous;
      const saved = await deps.settings.set(DEFAULT_STYLE_SETTING, styleId);
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
    handle: ({ styleId, style }) => {
      const current = store.get(styleId);
      if (style === null) {
        if (current.ok) store.remove(styleId);
        return ok({ result: { styleId } });
      }
      if (style.id !== styleId) return err(ValidationError({ field: 'styleId' }));
      const stored = current.ok ? store.put(style, current.value.revision) : store.create(style);
      return stored.ok ? ok({ result: { styleId, revision: style.revision } }) : stored;
    },
  });

  return [create, update, rename, remove, setDefault, restore];
}
