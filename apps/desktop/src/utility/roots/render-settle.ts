// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Renders whose export job ended without them, settled in the jobs process (FIX-LOSTRENDER; render's
 * jobs/lost-renders.ts says why). Two moments:
 *  - when a `render.export` job fails for good, or is cancelled while it waits: its render is settled at once. A
 *    job cancelled while it ran is settled by its own handler instead, after the render process's last write;
 *  - at start, once the queue has taken back the last run's jobs: every render still waiting or running whose
 *    export job can no longer run (the app closed between the two writes, or the row is from before this rule).
 * Nothing here starts or stops a job. Electron-free.
 */
import {
  ClockToken,
  EventBusToken,
  idSchema,
  JobStoreToken,
  RENDER_JOB_KINDS,
  RenderStoreToken,
  type Clock,
  type Container,
  type EventBus,
  type JobStore,
  type RenderId,
  type RenderStore,
  type Unsubscribe,
} from '@taalcut/core';
import { settleEndedExport, settleLostRenders, type ExportJobEnd } from '@taalcut/render';
import { z } from 'zod';

export interface RenderSettleDeps {
  readonly bus: Pick<EventBus, 'on'>;
  readonly jobs: Pick<JobStore, 'get' | 'list'>;
  readonly store: Pick<RenderStore, 'get' | 'list' | 'update'>;
  readonly clock: Pick<Clock, 'now'>;
  readonly log?: (message: string) => void;
}

/** A job's stored input, read for its render alone: an older build's request is not judged here. */
const exportInput = z.object({ renderId: idSchema<'Render'>() });

function renderOf(input: unknown): RenderId | null {
  const parsed = exportInput.safeParse(input);
  return parsed.success ? parsed.data.renderId : null;
}

/** Settles the render of every export job that ends for good without it. */
export function followEndedExports(deps: RenderSettleDeps): Unsubscribe {
  const log = deps.log ?? ((message: string) => console.warn(message));
  return deps.bus.on('job.stateChanged', ({ payload }) => {
    if (payload.kind !== RENDER_JOB_KINDS.export) return;
    const end: ExportJobEnd | null =
      payload.to === 'failed'
        ? { state: 'failed', error: payload.error ?? null }
        : payload.to === 'cancelled' && payload.from !== 'running'
          ? { state: 'cancelled' }
          : null;
    if (!end) return;
    void (async () => {
      const job = await deps.jobs.get(payload.jobId);
      const renderId = job.ok ? renderOf(job.value.input) : null;
      if (!renderId) return;
      const settled = await settleEndedExport(deps, renderId, end);
      if (!settled.ok)
        log(`[render] render ${renderId} not settled after its job ended: ${settled.error.code}`);
    })();
  });
}

/** The start sweep: renders still waiting or running with no export job that can run. */
export async function settleLostRendersAtStart(deps: RenderSettleDeps): Promise<readonly RenderId[]> {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const jobs = await deps.jobs.list({
    kind: RENDER_JOB_KINDS.export,
    states: ['queued', 'running', 'paused'],
    limit: 1000,
  });
  if (!jobs.ok) {
    log(`[render] lost renders not looked for: ${jobs.error.code}`);
    return [];
  }
  const live = new Set<RenderId>();
  for (const job of jobs.value) {
    const renderId = renderOf(job.input);
    if (renderId) live.add(renderId);
  }
  const settled = await settleLostRenders(deps, live);
  if (!settled.ok) {
    log(`[render] lost renders not settled: ${settled.error.code}`);
    return [];
  }
  if (settled.value.length > 0)
    log(`[render] ${settled.value.length} render(s) had no export job left: stopped`);
  return settled.value;
}

/** Both, from the jobs process's container: call once the engine has started. */
export async function settleRenders(container: Container): Promise<void> {
  if (!container.has(RenderStoreToken)) return;
  const deps: RenderSettleDeps = {
    bus: container.resolve(EventBusToken),
    jobs: container.resolve(JobStoreToken),
    store: container.resolve(RenderStoreToken),
    clock: container.resolve(ClockToken),
  };
  followEndedExports(deps);
  await settleLostRendersAtStart(deps);
}
