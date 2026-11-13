// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * export.completed's facts in the agent process (P2-X7, gate criteria 1 and
 * 2): the exported timeline's slot provenance against the assembly's result
 * (the timeline's first saved version), and whether this is the user's first
 * export. The first export is remembered by a marker file next to the
 * telemetry outbox, made once with an exclusive create; nothing in it.
 */
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import {
  RenderStoreToken,
  TimelineStoreToken,
  type Container,
  type RenderId,
  type Timeline,
  type TimelineId,
  type TimelineStore,
} from '@taalcut/core';
import type { FlowExportFacts } from '@taalcut/agent';
import type { LibraryTimelineStore } from '@taalcut/library';
import { migrateTimeline, slotProvenance } from '@taalcut/timeline';
import { UtilityConfigToken } from '../../shared/tokens';

const FIRST_EXPORT_MARKER = 'telemetry-first-export';
/** Pages of versions read to find the first one (50 a page). */
const MAX_PAGES = 20;

type Versions = LibraryTimelineStore['versions'];

const versionsOf = (store: TimelineStore): Versions | undefined =>
  'versions' in store ? (store as LibraryTimelineStore).versions : undefined;

function parsed(json: unknown, schemaVersion: number): Timeline | null {
  const timeline = migrateTimeline(json, schemaVersion);
  return timeline.ok ? timeline.value : null;
}

/** The oldest saved version: the assembly's result (the store snapshots it at create). */
function assembled(versions: Versions, timelineId: TimelineId): Timeline | null {
  let cursor: string | undefined;
  let oldest: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const listed = versions.list(timelineId, { limit: 50, ...(cursor ? { cursor } : {}) });
    if (!listed.ok) return null;
    oldest = listed.value.items.at(-1)?.id ?? oldest;
    cursor = listed.value.nextCursor;
    if (!cursor) break;
  }
  if (!oldest) return null;
  const record = versions.get(oldest as never);
  return record.ok ? parsed(record.value.json, record.value.schemaVersion) : null;
}

/** The timeline at the exported revision: the working copy, or the `export` version render kept. */
async function exported(
  store: TimelineStore,
  timelineId: TimelineId,
  revision: number,
): Promise<Timeline | null> {
  const current = await store.get(timelineId);
  if (!current.ok) return null;
  const now = parsed(current.value.json, current.value.schemaVersion);
  if (now?.revision === revision) return now;
  const versions = versionsOf(store);
  const listed = versions?.list(timelineId, { limit: 50 });
  const match = listed?.ok ? listed.value.items.find((item) => item.revision === revision) : undefined;
  const record = match ? versions?.get(match.id) : undefined;
  return record?.ok ? parsed(record.value.json, record.value.schemaVersion) : now;
}

/** True the first time only: the marker is created exclusively. */
async function firstExport(userData: string): Promise<boolean> {
  try {
    const handle = await open(join(userData, FIRST_EXPORT_MARKER), 'wx');
    await handle.close();
    return true;
  } catch {
    return false;
  }
}

export function flowExportFacts(container: Container): FlowExportFacts | undefined {
  if (
    !container.has(TimelineStoreToken) ||
    !container.has(RenderStoreToken) ||
    !container.has(UtilityConfigToken)
  )
    return undefined;
  return {
    async facts(input) {
      const render = await container.resolve(RenderStoreToken).get(input.renderId as RenderId);
      if (!render.ok) return undefined;
      const store = container.resolve(TimelineStoreToken);
      const timelineId = input.timelineId as TimelineId;
      const timeline = await exported(store, timelineId, render.value.timelineRevision);
      if (!timeline) return undefined;
      const versions = versionsOf(store);
      const provenance = slotProvenance(versions ? assembled(versions, timelineId) : null, timeline);
      return {
        ...provenance,
        firstExport: await firstExport(container.resolve(UtilityConfigToken).userData),
      };
    },
  };
}
