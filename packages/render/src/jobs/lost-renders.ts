// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Renders whose export job ended without them (FIX-LOSTRENDER; the owner, 2026-11-15: an export at "Waiting to
 * start" for good). The render process settles a render's row when the export ends there. A job can end without
 * that: cancelled while it waited in the queue, cancelled by its id while it ran (the render process then put the
 * row back to `queued` for the job that would take it over, and none did), failed for good once its time ran out,
 * or the app closing between the two writes. Such a row stayed `queued`: shown as waiting, and handed back for
 * every repeat of the same export. These settle it: `cancelled` reads "Stopped before it finished", and a failure
 * keeps its reason.
 */
import {
  ok,
  type AsyncResult,
  type Clock,
  type RenderId,
  type RenderStore,
  type TaalcutError,
} from '@taalcut/core';
import { RUNNING_RENDER_STATUSES } from '../store/snapshot';

export interface LostRenderDeps {
  readonly store: Pick<RenderStore, 'get' | 'list' | 'update'>;
  readonly clock: Pick<Clock, 'now'>;
}

/** How an export job ended for good. */
export type ExportJobEnd =
  { readonly state: 'cancelled' } | { readonly state: 'failed'; readonly error?: TaalcutError | null };

/** A row this new may be between its creation and its job: the start sweep leaves it alone. */
export const LOST_RENDER_GRACE_MS = 60_000;

const visible = (error: TaalcutError) => {
  const { detail: _detail, ...shown } = error;
  return shown;
};

/**
 * The render of an export job that ended for good: a row still waiting or running is settled the way the job
 * ended. True when the row changed. For a job that was running, call it once the handler has returned: until
 * then the render process writes the row.
 */
export async function settleEndedExport(
  deps: Pick<LostRenderDeps, 'clock'> & { readonly store: Pick<RenderStore, 'get' | 'update'> },
  renderId: RenderId,
  end: ExportJobEnd,
): AsyncResult<boolean> {
  const record = await deps.store.get(renderId);
  if (!record.ok) return record.error.code === 'core.not_found' ? ok(false) : record;
  if (!RUNNING_RENDER_STATUSES.has(record.value.status)) return ok(false);
  const finishedAt = deps.clock.now();
  const saved = await deps.store.update(
    renderId,
    end.state === 'cancelled'
      ? { status: 'cancelled', finishedAt }
      : { status: 'failed', error: end.error ? visible(end.error) : null, finishedAt },
  );
  return saved.ok ? ok(true) : saved;
}

/**
 * At start, once the queue has taken back the last run's jobs: every render still waiting or running whose export
 * job can no longer run. `live` is the renders of the export jobs that are queued, running or paused.
 */
export async function settleLostRenders(
  deps: LostRenderDeps,
  live: ReadonlySet<RenderId>,
): AsyncResult<readonly RenderId[]> {
  const listed = await deps.store.list({ limit: 500 });
  if (!listed.ok) return listed;
  const now = deps.clock.now();
  const settled: RenderId[] = [];
  for (const record of listed.value) {
    if (!RUNNING_RENDER_STATUSES.has(record.status) || live.has(record.id)) continue;
    if (record.createdAt > now - LOST_RENDER_GRACE_MS) continue;
    const saved = await deps.store.update(record.id, { status: 'cancelled', finishedAt: now });
    if (!saved.ok) return saved;
    settled.push(record.id);
  }
  return ok(settled);
}
