// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-S2: the model process's side. It opens the model once, on the client's `open`, answers windows in the order
 * they came by their ids (a window the model fails is that window's error), ignores anything outside the
 * protocol, and ends when released (letting the model go first) or when its client is gone.
 */
import { err, ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { FromModel } from '../../src/cuts/model-protocol';
import { serveShotModel, type ModelPort } from '../../src/cuts/model-serve';
import type { ShotBoundaryModel } from '../../src/cuts/transnet';
import { ShotModelFailed } from '../../src/errors';
import { pictureChangeModel } from '../../src/test-support';
import { grayWindow, settle } from '../helpers/model-pair';

function port() {
  const sent: FromModel[] = [];
  let receive: (raw: unknown) => void = () => undefined;
  let gone: () => void = () => undefined;
  const side: ModelPort = {
    send: (message) => sent.push(message),
    onMessage: (listener) => {
      receive = listener;
    },
    onGone: (listener) => {
      gone = listener;
    },
  };
  return { side, sent, receive: (raw: unknown) => receive(raw), leave: () => gone() };
}

describe('serveShotModel', () => {
  it('opens once, answers windows in order by id, and ends released after letting the model go', async () => {
    const { side, sent, receive } = port();
    let opens = 0;
    let released = 0;
    const model: ShotBoundaryModel = {
      ...pictureChangeModel(),
      async predict(window) {
        if (window[0] === 7) return err(ShotModelFailed(undefined, { detail: 'run failed' }));
        return pictureChangeModel().predict(window);
      },
      release: async () => {
        released += 1;
      },
    };
    const runtimes: unknown[] = [];
    const served = serveShotModel(side, async (dir, runtime) => {
      opens += 1;
      runtimes.push(runtime);
      expect(dir).toBe('/m');
      return ok(model);
    });
    receive({ type: 'open', modelDir: '/m', devices: ['webgpu', 'cpu'], disableGpu: false });
    receive({ type: 'open', modelDir: '/other' });
    receive({ type: 'predict', id: 4, window: grayWindow([7]) });
    receive({ type: 'predict', id: 5, window: grayWindow([0, 200]) });
    receive({ type: 'nonsense' });
    receive({ type: 'release' });
    expect(await served).toBe('released');
    expect(sent.map((m) => [m.type, 'id' in m ? m.id : undefined])).toEqual([
      ['ready', undefined],
      ['error', 4],
      ['output', 5],
      ['released', undefined],
    ]);
    expect([opens, released]).toEqual([1, 1]);
    // The jobs process's probe chose the devices; a `disableGpu: false` adds nothing.
    expect(runtimes).toEqual([{ devices: ['webgpu', 'cpu'] }]);
  });

  it('tells the client the model failed when handling a message throws, and answers the next one', async () => {
    const { side, sent, receive } = port();
    const model: ShotBoundaryModel = {
      ...pictureChangeModel(),
      async predict(window) {
        if (window[0] === 9) throw new Error('the runtime crashed');
        return pictureChangeModel().predict(window);
      },
      release: async () => undefined,
    };
    const served = serveShotModel(side, async () => ok(model));
    receive({ type: 'open', modelDir: '/m' });
    receive({ type: 'predict', id: 1, window: grayWindow([9]) });
    receive({ type: 'predict', id: 2, window: grayWindow([0, 200]) });
    receive({ type: 'release' });
    expect(await served).toBe('released');
    expect(sent.map((m) => m.type)).toEqual(['ready', 'failed', 'output', 'released']);
    expect(sent[1]).toMatchObject({
      type: 'failed',
      error: expect.objectContaining({ code: expect.any(String) }),
    });
  });

  it('says why the model failed to open, and ends when its client is gone', async () => {
    const { side, sent, receive, leave } = port();
    const served = serveShotModel(side, async () => err(ShotModelFailed(undefined, { detail: 'no file' })));
    receive({ type: 'open', modelDir: '/m' });
    await settle();
    expect(sent).toEqual([{ type: 'failed', error: expect.objectContaining({ detail: 'no file' }) }]);
    leave();
    expect(await served).toBe('gone');
  });
});
