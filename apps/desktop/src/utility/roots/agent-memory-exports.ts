// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "What worked" from main's exports (LRN1-MEM): main serves its render.finished events to the agent
 * (MAIN_SERVICE_CONTRACTS.agent.mainEvents, filtered on main's side). The agent reads the stream itself and never
 * republishes it on its own bus, which main bridges back: the same event would come round again.
 *
 * A stream that ends with an error (main's side went away) is opened again after a pause; an export finished
 * meanwhile is recorded by the next start's catch-up, after the watermark.
 */
import { callRpc, type MainServicesClient, type EventPayload } from '@taalcut/core';
import type { WhatWorkedRecorder } from '@taalcut/agent';

const REOPEN_MS = 30_000;

export interface ExportsFollower {
  stop(): void;
}

export function followMainExports(
  main: () => Pick<MainServicesClient<'agent'>, 'mainEvents'>,
  recorder: WhatWorkedRecorder,
): ExportsFollower {
  return followMainRenderEvents(main, async ({ renderId, status }) => {
    if (status !== 'ready') return;
    const done = await recorder.record(renderId);
    if (!done.ok) console.warn(`[memory] export ${renderId} not recorded: ${done.error.code}`);
  });
}

/** Product campaigns also need failure events; neither consumer republishes main's stream. */
export function followMainRenderEvents(
  main: () => Pick<MainServicesClient<'agent'>, 'mainEvents'>,
  record: (payload: EventPayload<'render.finished'>) => void | Promise<void>,
): ExportsFollower {
  const controller = new AbortController();
  const { signal } = controller;

  async function follow(): Promise<void> {
    while (!signal.aborted) {
      const stream = await callRpc(main().mainEvents.subscribe({ types: ['render.finished'] }, { signal }));
      if (stream.ok) {
        const ended = await callRpc(
          (async () => {
            for await (const event of stream.value)
              if (event.type === 'render.finished') await record(event.payload);
          })(),
        );
        if (signal.aborted) return;
        if (!ended.ok) console.warn(`[memory] main's exports stream ended: ${ended.error.code}`);
      } else if (!signal.aborted) {
        console.warn(`[memory] main's exports not followed: ${stream.error.code}`);
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, REOPEN_MS);
        timer.unref?.();
        signal.addEventListener('abort', done, { once: true });
      });
    }
  }

  void follow();
  return { stop: () => controller.abort() };
}
