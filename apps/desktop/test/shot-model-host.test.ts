// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-S2: main's side of the shot-boundary model's process, with fake utility processes. The jobs process asks on
 * its parent port; main forks the model process and hands each one end of a new channel. Only the jobs process
 * may ask; a fork that fails is answered with why; when the jobs process exits (a crash, kill -9, a quit) its model
 * processes are stopped, and a new request stops its older ones, so none outlives it.
 */
import { describe, expect, it } from 'vitest';
import {
  shotModelHost,
  type ShotModelChild,
  type ShotModelRequester,
} from '../src/main/shot-model/shot-model-host';
import { SHOT_MODEL_IPC } from '../src/shared/shot-model-ipc';

type Port = { readonly name: string };

function fakeChild(pid: number) {
  const exits: ((code: number) => void)[] = [];
  const child = {
    pid,
    killed: false,
    posted: [] as { message: unknown; transfer: Port[] }[],
    postMessage(message: unknown, transfer: Port[]) {
      child.posted.push({ message, transfer });
    },
    kill() {
      child.killed = true;
      for (const exit of exits.splice(0)) exit(0);
      return true;
    },
    once(_event: 'exit', listener: (code: number) => void) {
      exits.push(listener);
    },
  } satisfies ShotModelChild<Port> & Record<string, unknown>;
  return child;
}

function fakeRequester() {
  const listeners: ((message: unknown) => void)[] = [];
  const exits: ((code: number) => void)[] = [];
  const requester = {
    replies: [] as { message: unknown; transfer: Port[] | undefined }[],
    on(_event: 'message', listener: (message: unknown) => void) {
      listeners.push(listener);
    },
    once(_event: 'exit', listener: (code: number) => void) {
      exits.push(listener);
    },
    postMessage(message: unknown, transfer?: Port[]) {
      requester.replies.push({ message, transfer });
    },
    ask: (request: number) => listeners.forEach((l) => l({ type: SHOT_MODEL_IPC.request, request })),
    send: (message: unknown) => listeners.forEach((l) => l(message)),
    exit: () => exits.forEach((e) => e(137)),
  } satisfies ShotModelRequester<Port> & Record<string, unknown>;
  return requester;
}

function host(fork: () => ShotModelChild<Port>) {
  let channels = 0;
  return shotModelHost<Port>({
    fork,
    createChannel: () => {
      channels += 1;
      return { model: { name: `model-${channels}` }, client: { name: `client-${channels}` } };
    },
    connect: { componentsRoot: '/u/components', packaged: true },
    allowed: ['jobs'],
    log: () => undefined,
  });
}

describe('the shot model host', () => {
  it('forks the model process for the jobs process and hands each an end of one channel', () => {
    const models = [fakeChild(11)];
    const shots = host(() => models[0]!);
    const jobs = fakeRequester();
    shots.attach('jobs', jobs);
    jobs.ask(0);
    expect(models[0]!.posted).toEqual([
      {
        message: { type: SHOT_MODEL_IPC.connect, componentsRoot: '/u/components', packaged: true },
        transfer: [{ name: 'model-1' }],
      },
    ]);
    expect(jobs.replies).toEqual([
      { message: { type: SHOT_MODEL_IPC.port, request: 0 }, transfer: [{ name: 'client-1' }] },
    ]);
  });

  it('serves only the processes allowed to ask, and only well-formed requests', () => {
    let forks = 0;
    const shots = host(() => {
      forks += 1;
      return fakeChild(forks);
    });
    const agent = fakeRequester();
    shots.attach('agent', agent);
    agent.ask(0);
    const jobs = fakeRequester();
    shots.attach('jobs', jobs);
    jobs.send({ type: SHOT_MODEL_IPC.request, request: -1 });
    jobs.send({ type: 'something else' });
    expect([forks, agent.replies, jobs.replies]).toEqual([0, [], []]);
  });

  it('answers with why when the model process can’t be forked', () => {
    const shots = host(() => {
      throw new Error('no utility process');
    });
    const jobs = fakeRequester();
    shots.attach('jobs', jobs);
    jobs.ask(3);
    expect(jobs.replies).toEqual([
      {
        message: {
          type: SHOT_MODEL_IPC.port,
          request: 3,
          error: 'the shot model process could not start: Error: no utility process',
        },
        transfer: undefined,
      },
    ]);
  });

  it('stops the model processes of a jobs process that exits, and the older ones on a new request', () => {
    const forked: ReturnType<typeof fakeChild>[] = [];
    const shots = host(() => {
      const child = fakeChild(forked.length + 1);
      forked.push(child);
      return child;
    });
    const jobs = fakeRequester();
    shots.attach('jobs', jobs);
    jobs.ask(0);
    jobs.ask(1);
    expect(forked.map((c) => c.killed)).toEqual([true, false]);
    jobs.exit();
    expect(forked.map((c) => c.killed)).toEqual([true, true]);
  });
});
