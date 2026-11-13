// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { EventOf } from '@taalcut/core';
import { useBackendEvents } from '../../backend/use-events';
import { reportWork, workRunning, type WorkPhase } from './companion-work';

const WATCHED = [
  'job.stateChanged',
  'render.finished',
  'components.downloads',
  'library.indexing',
  'transfer.deviceRun',
  'agent.runStarted',
  'agent.runFinished',
] as const;

type Watched = EventOf<(typeof WATCHED)[number]>;

/** An end, reported only for what was seen running: a state that says "ready" again isn't news. */
function end(key: string, phase: Exclude<WorkPhase, 'running'>): void {
  if (workRunning(key)) reportWork(key, phase);
}

/** One backend event, as the companion reads it. */
export function readWorkEvent(event: Watched): void {
  switch (event.type) {
    case 'job.stateChanged': {
      const key = `job:${event.payload.jobId}`;
      const to = event.payload.to;
      if (to === 'running') reportWork(key, 'running');
      else if (to === 'succeeded') reportWork(key, 'succeeded');
      else if (to === 'failed') reportWork(key, 'failed');
      else if (to === 'cancelled' || to === 'paused') reportWork(key, 'stopped');
      return;
    }
    case 'render.finished': {
      const key = `render:${event.payload.renderId}`;
      const status = event.payload.status;
      if (status === 'ready') reportWork(key, 'succeeded', { moment: true });
      else if (status === 'cancelled') reportWork(key, 'stopped');
      else reportWork(key, 'failed');
      return;
    }
    case 'components.downloads': {
      const state = event.payload.state;
      if (state === 'downloading') reportWork('downloads', 'running');
      else if (state === 'ready') end('downloads', 'succeeded');
      else if (state === 'failed') end('downloads', 'failed');
      else end('downloads', 'stopped');
      return;
    }
    case 'library.indexing': {
      const { paused, overall } = event.payload;
      // Clips held for a model or their original aren't work running (LIB1-PROG): as the window bar counts them.
      if (!paused && overall.active + overall.waiting - (overall.held ?? 0) > 0)
        reportWork('indexing', 'running');
      else end('indexing', paused ? 'stopped' : 'succeeded');
      return;
    }
    case 'transfer.deviceRun': {
      const key = `usb:${event.payload.id}`;
      const state = event.payload.state;
      if (state === 'running') reportWork(key, 'running');
      else end(key, state === 'succeeded' ? 'succeeded' : state === 'failed' ? 'failed' : 'stopped');
      return;
    }
    case 'agent.runStarted':
      reportWork(`run:${event.payload.runId}`, 'running');
      return;
    case 'agent.runFinished': {
      const status = event.payload.status;
      end(
        `run:${event.payload.runId}`,
        status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : 'stopped',
      );
      return;
    }
  }
}

/**
 * The companion's eyes on the app's work: an agent's run, a job (an import, indexing, a download, an export), the
 * models' download, a phone on a cable. In the root, so it watches on every page, Settings and first run included.
 */
export function useCompanionEvents(): void {
  useBackendEvents(WATCHED, readWorkEvent);
}
