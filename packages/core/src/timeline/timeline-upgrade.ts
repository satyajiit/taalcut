// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stored timelines at an older schema version, brought up to TIMELINE_SCHEMA_VERSION one step at a time before
 * they are validated. The library, @taalcut/timeline and render read stored documents and snapshots through
 * here, so a document saved by an older build always loads. A step only adds what its version introduced, with
 * the value that keeps the old behaviour; it never guesses at a version this build doesn't know.
 */
import { ValidationError } from '../basics/errors';
import { err, ok, type Result } from '../basics/result';
import { DEFAULT_MIX } from './mix';
import { TIMELINE_SCHEMA_VERSION, timelineSchema, type Timeline } from './timeline-schema';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Maps the objects of an array, leaving anything that isn't one as it is for the schema to report. */
function mapObjects(value: unknown, step: (item: JsonObject) => JsonObject): unknown {
  return Array.isArray(value) ? value.map((item) => (isObject(item) ? step(item) : item)) : value;
}

/** v1 clips play as before: no still motion, no reframe. */
function clipV2(item: JsonObject): JsonObject {
  return item.type === 'clip' ? { stillMotion: null, reframe: null, ...item } : item;
}

/** v1 audio tracks are the clips' own sound. */
function trackV2(track: JsonObject): JsonObject {
  if (track.kind === 'text') return track;
  const items = mapObjects(track.items, clipV2);
  return track.kind === 'audio' ? { role: 'clip', ...track, items } : { ...track, items };
}

/** Version 1 → 2 (P3): no look, no voiceover, default ducking, and the clip and track fields above. */
function v1ToV2(doc: JsonObject): JsonObject {
  return {
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    ...doc,
    schemaVersion: 2,
    tracks: mapObjects(doc.tracks, trackV2),
  };
}

/** In order: step i turns a version i + 1 document into version i + 2, so there are TIMELINE_SCHEMA_VERSION − 1. */
export const TIMELINE_UPGRADE_STEPS: readonly ((doc: JsonObject) => JsonObject)[] = [v1ToV2];

/** A schema version this build can't read: newer than it, or not a version at all. */
function unsupported(schemaVersion: number): Result<never> {
  return err(
    ValidationError({ field: 'schemaVersion' }, { detail: `Can't read timeline schema ${schemaVersion}` }),
  );
}

/**
 * The stored JSON brought to the current schema version, not yet validated (a document that isn't an object is
 * passed on for the schema to refuse). `core.validation` with `field: 'schemaVersion'` for a version this build
 * can't read.
 */
export function upgradeTimelineJson(json: unknown, schemaVersion: number): Result<unknown> {
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > TIMELINE_SCHEMA_VERSION)
    return unsupported(schemaVersion);
  let doc = json;
  for (const step of TIMELINE_UPGRADE_STEPS.slice(schemaVersion - 1)) {
    if (!isObject(doc)) break;
    doc = step(doc);
  }
  return ok(doc);
}

/**
 * A stored timeline as the current Timeline: upgraded, then checked by timelineSchema. `core.validation` with
 * `field: 'schemaVersion'` for a version this build can't read, `field: 'timeline'` (the issues' paths and
 * messages in `detail`) for a document that doesn't hold.
 */
export function upgradeTimeline(json: unknown, schemaVersion: number): Result<Timeline> {
  const upgraded = upgradeTimelineJson(json, schemaVersion);
  if (!upgraded.ok) return upgraded;
  const parsed = timelineSchema.safeParse(upgraded.value);
  if (parsed.success) return ok(parsed.data);
  const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  return err(ValidationError({ field: 'timeline' }, { detail: detail.slice(0, 2000) }));
}
