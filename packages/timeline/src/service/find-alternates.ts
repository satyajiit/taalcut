// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Find something else" (`timelines.findAlternates`): fresh candidates for one cast slot of a timeline, scored
 * against the clips either side, with every shot the timeline already uses left out.
 */
import {
  err,
  NotImplementedError,
  type AsyncResult,
  type CastCandidate,
  type FindAlternatesInput,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import type { CastingEngine } from '../casting/engine';
import { ItemNotFound, TemplateNotFound } from '../errors';
import { clipKey, clipShot } from '../model/cast';
import { positions, videoItems, type Position } from '../model/sequence';
import type { TemplateReader } from './templates';

export interface FindAlternatesDeps {
  readonly read: (timelineId: TimelineId) => AsyncResult<Timeline>;
  /** Absent (with `templates`): core.not_implemented. */
  readonly engine?: CastingEngine;
  readonly templates?: TemplateReader;
}

/** The shot a neighbouring position shows, as the engine scores against it; null for a gap or audio. */
const neighbour = (position: Position | undefined) =>
  position?.item.type === 'clip' ? clipShot(position.item) : null;

export function createFindAlternates(deps: FindAlternatesDeps) {
  return async function findAlternates(input: FindAlternatesInput): AsyncResult<CastCandidate[]> {
    const { engine, templates } = deps;
    if (!engine || !templates) return err(NotImplementedError({ feature: 'timeline.casting' }));
    const timeline = await deps.read(input.timelineId);
    if (!timeline.ok) return timeline;
    const ref = timeline.value.template;
    if (!ref) return err(TemplateNotFound({ templateId: 'none' }));
    const template = await templates.read(ref);
    if (!template.ok) return template;
    const all = positions(videoItems(timeline.value));
    const index = all.findIndex((position) => position.item.slotId === input.slotId);
    if (index < 0) return err(ItemNotFound({ itemId: input.slotId }));
    const used = all.flatMap(({ item }) => (item.type === 'clip' ? (clipKey(item) ?? []) : []));
    return engine.alternates({
      template: template.value,
      slotId: input.slotId,
      previous: neighbour(all[index - 1]),
      next: neighbour(all[index + 1]),
      used,
      exclude: input.exclude,
      limit: input.limit,
      canvas: timeline.value.canvas,
    });
  };
}
