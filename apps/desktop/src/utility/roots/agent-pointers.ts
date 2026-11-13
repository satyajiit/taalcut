// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reference timestamps (P3-V15) in the agent process: the pointer resolver over the library's template and
 * timeline stores, each document migrated to the current schema (templates' migrateTemplate, core's
 * upgradeTimeline) before the agent reads it. Without both stores (a build with no make flow) there is no
 * resolver, and messages run as before. EDT1: the editor resolver reads the timeline a docked message was sent
 * from the same way.
 */
import {
  TemplateStoreToken,
  TimelineStoreToken,
  upgradeTimeline,
  type Container,
  type TimelineId,
} from '@taalcut/core';
import {
  createEditorResolver,
  createPointerResolver,
  type EditorResolver,
  type PointerResolver,
} from '@taalcut/agent';
import { migrateTemplate } from '@taalcut/templates';

/** createAgent's `phase3.pointers` and `phase3.editor`, when the stores are there. */
export function pointerDeps(container: Container): {
  readonly pointers?: PointerResolver;
  readonly editor?: EditorResolver;
} {
  if (!container.has(TemplateStoreToken) || !container.has(TimelineStoreToken)) return {};
  const templates = container.resolve(TemplateStoreToken);
  const timelines = container.resolve(TimelineStoreToken);
  const timeline = async (timelineId: TimelineId) => {
    const stored = await timelines.get(timelineId);
    return stored.ok ? upgradeTimeline(stored.value.json, stored.value.schemaVersion) : stored;
  };
  const pointers = createPointerResolver({
    async template(templateId, version) {
      const stored = await templates.get(templateId, version);
      return stored.ok ? migrateTemplate(stored.value.json, stored.value.schemaVersion) : stored;
    },
    timeline,
  });
  return { pointers, editor: createEditorResolver({ timeline }) };
}
