// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** `timelines.gaps` and `timelines.shotList` (P3-B8): the gap list and the phone's shot list, with intents. */
import { ok, type AsyncResult, type GapView, type ShotListItem, type Template, type Timeline, type TimelineId } from '@taalcut/core';
import { TemplateNotFound } from '../errors';
import type { TemplateReader } from '../service/templates';
import { gapsOf, shotList } from './gaps';

export interface GapReadDeps {
  readonly read: (timelineId: TimelineId) => AsyncResult<Timeline>;
  /** Intents come from the timeline's template version; without one (story mode) they are null. */
  readonly templates?: TemplateReader;
}

export function createGapReads(deps: GapReadDeps) {
  async function withTemplate(timelineId: TimelineId): AsyncResult<{ timeline: Timeline; template: Template | null }> {
    const timeline = await deps.read(timelineId);
    if (!timeline.ok) return timeline;
    const ref = timeline.value.template;
    if (!ref || !deps.templates) return ok({ timeline: timeline.value, template: null });
    const template = await deps.templates.read(ref);
    // A template deleted since leaves the intents out rather than hiding the gaps; other failures are failures.
    if (!template.ok && !TemplateNotFound.is(template.error)) return template;
    return ok({ timeline: timeline.value, template: template.ok ? template.value : null });
  }

  return {
    async gaps(timelineId: TimelineId): AsyncResult<GapView[]> {
      const found = await withTemplate(timelineId);
      return found.ok ? ok(gapsOf(found.value.timeline, found.value.template)) : found;
    },
    async shotList(timelineId: TimelineId): AsyncResult<ShotListItem[]> {
      const found = await withTemplate(timelineId);
      return found.ok ? ok(shotList(found.value.timeline, found.value.template)) : found;
    },
  };
}
