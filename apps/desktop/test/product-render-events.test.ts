// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type EventPayload, type MainServicesClient, type TaalcutEvent } from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { followMainRenderEvents } from '../src/utility/roots/agent-memory-exports';

it('follows both completed and failed main-process renders without republishing them', async () => {
  const projectId = newId<'Project'>();
  const renderId = newId<'Render'>();
  const received: EventPayload<'render.finished'>[] = [];
  const subscribe = vi.fn(async function* () {
    for (const status of ['failed', 'ready'] as const)
      yield {
        type: 'render.finished',
        payload: { projectId, renderId, status },
      } as TaalcutEvent;
  });
  const main = () =>
    ({ mainEvents: { subscribe } }) as unknown as Pick<MainServicesClient<'agent'>, 'mainEvents'>;
  const follower = followMainRenderEvents(main, (payload) => {
    received.push(payload);
  });
  try {
    await vi.waitFor(() => expect(received.map((item) => item.status)).toEqual(['failed', 'ready']));
    expect(subscribe).toHaveBeenCalledTimes(1);
    const options = subscribe.mock.calls[0] as unknown as [unknown, { signal: AbortSignal }];
    follower.stop();
    expect(options[1].signal.aborted).toBe(true);
  } finally {
    follower.stop();
  }
});
