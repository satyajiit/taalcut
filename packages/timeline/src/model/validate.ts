// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reading stored timelines (migrations) and checking a document before it is
 * written: core's timelineSchema plus the one rule core leaves to this
 * package, ramped clips' media, which needs the speed curve integrated.
 */
import {
  err,
  ok,
  timelineSchema,
  upgradeTimelineJson,
  ValidationError,
  type Result,
  type Timeline,
} from '@taalcut/core';
import { InvalidMove, UnsupportedSchema } from '../errors';
import { positions, videoItems } from './sequence';
import { clipMediaFits } from './speed';

function issues(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
    .join('; ');
}

/** Ramped clips' consumed media lies inside `available`; paths of those that don't. */
export function rampProblems(timeline: Timeline): string[] {
  return positions(videoItems(timeline))
    .filter(({ item }) => item.type === 'clip' && item.speed !== null && !clipMediaFits(item, timeline.canvas.rate))
    .map(({ itemIndex }) => `tracks.0.items.${itemIndex}.speed: the ramp runs past the media`);
}

/** Stored JSON at `schemaVersion` → a valid Timeline. A newer version is refused. */
export function migrateTimeline(json: unknown, schemaVersion: number): Result<Timeline> {
  // Core steps an older document up to TIMELINE_SCHEMA_VERSION (upgradeTimelineJson); it refuses the rest.
  const upgraded = upgradeTimelineJson(json, schemaVersion);
  if (!upgraded.ok) return err(UnsupportedSchema({ schemaVersion }));
  const parsed = timelineSchema.safeParse(upgraded.value);
  if (!parsed.success) return err(ValidationError({ field: 'timeline' }, { detail: issues(parsed.error) }));
  const ramps = rampProblems(parsed.data);
  if (ramps.length > 0) return err(ValidationError({ field: 'timeline' }, { detail: ramps.join('; ') }));
  return ok(parsed.data);
}

/** An edited document, checked before it is stored: any broken rule makes the edit an invalid move. */
export function checkEdited(timeline: Timeline): Result<Timeline> {
  const parsed = timelineSchema.safeParse(timeline);
  if (!parsed.success) return err(InvalidMove(undefined, { detail: issues(parsed.error) }));
  const ramps = rampProblems(parsed.data);
  if (ramps.length > 0) return err(InvalidMove(undefined, { detail: ramps.join('; ') }));
  return ok(parsed.data);
}
