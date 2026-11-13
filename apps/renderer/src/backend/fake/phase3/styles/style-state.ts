// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake's style store (core's StyleStore, in memory) and the reads appContract.styles serves from it, as
 * @taalcut/templates' style service answers them: `list` marks the one `styles.default` names, `usedBy` counts
 * the timelines and template versions that name a Style, a missing Style is `templates.style_not_found`.
 */
import {
  ConflictError,
  DEFAULT_STYLE_SETTING,
  err,
  ok,
  type Result,
  type Style,
  type StyleId,
  type StyleSummary,
  type StyleUsage,
} from '@taalcut/core';
import type { Phase3Deps } from '../phase3-deps';
import { styleNotFound } from './style-errors';
import { seededStyles, STYLE_IDS } from './style-seed';

export type StyleStateDeps = Pick<Phase3Deps, 'settings' | 'templates' | 'make'>;

export function createStyleState(deps: StyleStateDeps, seeded: boolean) {
  const styles = new Map<StyleId, Style>(seeded ? seededStyles().map((style) => [style.id, style]) : []);
  // Chai & Co. is the default for new videos; the memory settings store answers at once.
  if (seeded) void deps.settings.set(DEFAULT_STYLE_SETTING, STYLE_IDS.chai);

  async function defaultId(): Promise<StyleId | null> {
    const chosen = await deps.settings.get(DEFAULT_STYLE_SETTING);
    return chosen.ok ? chosen.value : null;
  }

  function get(styleId: StyleId): Result<Style> {
    const style = styles.get(styleId);
    return style ? ok(style) : err(styleNotFound());
  }

  /** Template versions that name the Style, across every template's history (the store counts versions). */
  async function templateVersionsNaming(styleId: StyleId): Promise<number> {
    const listed = await deps.templates.list({ includeUnlisted: true, includeArchived: true, limit: 200 });
    let count = 0;
    for (const item of listed.items) {
      for (const version of deps.templates.versions(item.id) ?? []) {
        const found = await deps.templates.get(item.id, version.version);
        if (found?.template.styleId === styleId) count += 1;
      }
    }
    return count;
  }

  return {
    get,
    has: (styleId: StyleId) => styles.has(styleId),
    async list(): Promise<StyleSummary[]> {
      const chosen = await defaultId();
      return [...styles.values()]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((style) => ({
          id: style.id,
          name: style.name,
          kind: style.kind,
          revision: style.revision,
          colours: style.colours,
          logo: style.logo
            ? {
                asset: style.logo.asset,
                mediaType: style.logo.mediaType,
                width: style.logo.width,
                height: style.logo.height,
              }
            : null,
          isDefault: style.id === chosen,
          updatedAt: style.updatedAt,
        }));
    },
    async usedBy(styleId: StyleId): Promise<Result<StyleUsage>> {
      if (!styles.has(styleId)) return err(styleNotFound());
      const timelines = deps.make.timelines.all().filter((timeline) => timeline.styleId === styleId).length;
      return ok({ timelines, templates: await templateVersionsNaming(styleId) });
    },
    create(style: Style): Result<Style> {
      if (styles.has(style.id)) return err(ConflictError({ entity: 'style', id: style.id }));
      styles.set(style.id, style);
      return ok(style);
    },
    /** core.conflict unless the stored revision is `expectedRevision` (StyleStore.put). */
    put(style: Style, expectedRevision: number): Result<Style> {
      const current = styles.get(style.id);
      if (!current) return err(styleNotFound());
      if (current.revision !== expectedRevision) return err(ConflictError({ entity: 'style', id: style.id }));
      styles.set(style.id, style);
      return ok(style);
    },
    remove(styleId: StyleId): void {
      styles.delete(styleId);
    },
  };
}

export type StyleState = ReturnType<typeof createStyleState>;
