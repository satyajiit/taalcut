// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's way to the shot-boundary model's own process (IX2-S2): ask main on the parent port for one
 * (main/shot-model), take the MessagePortMain that comes back and use it as vision's `ModelChannel`. Main forks
 * as it answers, so a reply that doesn't come within `replyMs` means main can't: the window fails as the model
 * failing and the job falls back to scdet. Nothing here waits on the model itself; vision's session does that.
 */
import { err, ok, type AsyncResult, type EmitterPort, type MessageEventLike } from '@taalcut/core';
import { ShotModelFailed, type ModelChannel, type ModelPort } from '@taalcut/vision';
import { SHOT_MODEL_IPC, shotModelPortSchema } from '../shared/shot-model-ipc';

/** The part of Electron's `process.parentPort` used here. */
export interface ShotModelParent {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown; ports: readonly EmitterPort[] }) => void): unknown;
  removeListener(
    event: 'message',
    listener: (event: { data: unknown; ports: readonly EmitterPort[] }) => void,
  ): unknown;
}

/** A MessagePortMain as one end of the model's channel, sending `Out`; started here, so its messages flow. */
function portEnd<Out>(port: EmitterPort, goneDetail: string) {
  return {
    send: (message: Out) => port.postMessage(message),
    onMessage(listener: (raw: unknown) => void) {
      port.on('message', (event?: MessageEventLike) => listener(event?.data));
      port.start?.();
    },
    onGone: (listener: (detail: string) => void) => void port.on('close', () => listener(goneDetail)),
    close: () => port.close?.(),
  };
}

/** The jobs process's end: vision's channel to the model. */
export const portChannel = (port: EmitterPort): ModelChannel =>
  portEnd<Parameters<ModelChannel['send']>[0]>(port, 'the shot model process went away');

/** The model process's end (serve-shot-model.ts). */
export const modelPort = (port: EmitterPort): ModelPort =>
  portEnd<Parameters<ModelPort['send']>[0]>(port, 'the jobs process went away');

const failed = (detail: string) => ShotModelFailed(undefined, { detail });

/** Asks main for a model process each time it is called; `replyMs` bounds the wait for main's answer. */
export function shotModelPorts(parent: ShotModelParent, replyMs = 10_000): () => AsyncResult<ModelChannel> {
  let next = 0;
  return () => {
    const request = next++;
    return new Promise((resolve) => {
      const done = (result: Awaited<AsyncResult<ModelChannel>>) => {
        clearTimeout(timer);
        parent.removeListener('message', listener);
        resolve(result);
      };
      const listener = (event: { data: unknown; ports: readonly EmitterPort[] }) => {
        const reply = shotModelPortSchema.safeParse(event.data);
        if (!reply.success || reply.data.request !== request) return;
        const [port] = event.ports;
        if (reply.data.error !== undefined || !port)
          done(err(failed(reply.data.error ?? 'main sent no port')));
        else done(ok(portChannel(port)));
      };
      const timer = setTimeout(() => done(err(failed(`main didn't answer within ${replyMs} ms`))), replyMs);
      parent.on('message', listener);
      parent.postMessage({ type: SHOT_MODEL_IPC.request, request });
    });
  };
}
