// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-S2: how the jobs process gets a port to a new shot model process. It asks main on its parent port and takes
 * the port that comes back with its request's number (other replies aren't its); main's error, a reply with no
 * port or no reply at all is the model failing (the job's scdet fallback). The port, as vision's channel, is
 * started when listened to, gives each message's data and says when the model process goes away.
 */
import type { EmitterPort, MessageEventLike } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { SHOT_MODEL_IPC } from '../src/shared/shot-model-ipc';
import { modelPort, portChannel, shotModelPorts, type ShotModelParent } from '../src/utility/shot-model-port';

type ParentListener = (event: { data: unknown; ports: readonly EmitterPort[] }) => void;

function fakeParent() {
  const listeners = new Set<ParentListener>();
  const posted: unknown[] = [];
  const parent: ShotModelParent = {
    postMessage: (message) => posted.push(message),
    on: (_event, listener) => listeners.add(listener),
    removeListener: (_event, listener) => listeners.delete(listener),
  };
  const reply = (data: unknown, ports: readonly EmitterPort[] = []) =>
    [...listeners].forEach((l) => l({ data, ports }));
  return { parent, posted, reply, listening: () => listeners.size };
}

function fakePort() {
  const listeners: Record<'message' | 'close', ((event?: MessageEventLike) => void)[]> = {
    message: [],
    close: [],
  };
  const state = { sent: [] as unknown[], started: 0, closed: 0 };
  const port: EmitterPort = {
    postMessage: (message: unknown) => void state.sent.push(message),
    on(type: 'message' | 'close', listener: (event?: MessageEventLike) => void) {
      listeners[type].push(listener);
    },
    start: () => void (state.started += 1),
    close: () => void (state.closed += 1),
  };
  const emit = (type: 'message' | 'close', event?: MessageEventLike) =>
    listeners[type].forEach((l) => l(event));
  return { port, state, emit };
}

describe('shotModelPorts', () => {
  it('asks main and takes the port that answers its request', async () => {
    const { parent, posted, reply, listening } = fakeParent();
    const start = shotModelPorts(parent);
    const first = start();
    const second = start();
    expect(posted).toEqual([
      { type: SHOT_MODEL_IPC.request, request: 0 },
      { type: SHOT_MODEL_IPC.request, request: 1 },
    ]);
    const { port, state } = fakePort();
    reply({ type: SHOT_MODEL_IPC.port, request: 1 }, [port]);
    reply({ type: 'taalcut:connect' }, [fakePort().port]);
    const got = await second;
    if (!got.ok) throw new Error(got.error.code);
    got.value.send({ type: 'release' });
    expect(state.sent).toEqual([{ type: 'release' }]);
    reply({ type: SHOT_MODEL_IPC.port, request: 0, error: 'no fork' });
    const failed = await first;
    expect(!failed.ok && [failed.error.code, failed.error.detail]).toEqual([
      'vision.shot_model_failed',
      'no fork',
    ]);
    expect(listening()).toBe(0);
  });

  it('fails when main sends no port, or doesn’t answer', async () => {
    vi.useFakeTimers();
    try {
      const { parent, reply } = fakeParent();
      const start = shotModelPorts(parent, 1000);
      const portless = start();
      reply({ type: SHOT_MODEL_IPC.port, request: 0 });
      const none = await portless;
      expect(!none.ok && none.error.detail).toBe('main sent no port');
      const silent = start();
      vi.advanceTimersByTime(1000);
      const late = await silent;
      expect(!late.ok && late.error.detail).toBe("main didn't answer within 1000 ms");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('portChannel', () => {
  it('starts the port when listened to, passes each message’s data, and says when the process goes', () => {
    const { port, state, emit } = fakePort();
    const channel = portChannel(port);
    const received: unknown[] = [];
    const gone: string[] = [];
    channel.onMessage((raw) => received.push(raw));
    channel.onGone((detail) => gone.push(detail));
    expect(state.started).toBe(1);
    emit('message', { data: { type: 'released' } });
    emit('close');
    channel.close();
    expect([received, gone, state.closed]).toEqual([
      [{ type: 'released' }],
      ['the shot model process went away'],
      1,
    ]);
  });

  it('is the model process’s end too', () => {
    const { port, state, emit } = fakePort();
    const end = modelPort(port);
    let gone = 0;
    end.onMessage(() => undefined);
    end.onGone(() => (gone += 1));
    end.send({ type: 'released' });
    emit('close');
    expect([state.started, state.sent, gone]).toEqual([1, [{ type: 'released' }], 1]);
  });
});
