// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-S2: the shot model's utility process. It waits for main's connect message with the port to the jobs
 * process, installs ONNX Runtime's binding from the onnxruntime component, serves the model on that port and
 * exits when the jobs process releases it or goes away; it exits too when main never connects it or sends
 * something else.
 */
import type { EmitterPort } from '@taalcut/core';
import type { ModelPort, ServeEnd } from '@taalcut/vision';
import { describe, expect, it, vi } from 'vitest';
import { SHOT_MODEL_IPC } from '../src/shared/shot-model-ipc';
import { serveShotModelProcess, type ModelParentPort } from '../src/utility/serve-shot-model';

type ParentListener = (event: { data: unknown; ports: readonly EmitterPort[] }) => void;

function fakeParent() {
  let listener: ParentListener = () => undefined;
  const parent: ModelParentPort = {
    once: (_event, l) => {
      listener = l;
    },
  };
  return { parent, connect: (data: unknown, ports: readonly EmitterPort[]) => listener({ data, ports }) };
}

const port = (): EmitterPort => ({ postMessage: () => undefined, on: () => undefined });

describe('the shot model process', () => {
  it('installs ONNX Runtime’s binding, serves the model on the jobs process’s port, and exits when released', async () => {
    const { parent, connect } = fakeParent();
    const exits: number[] = [];
    const installed: unknown[] = [];
    let end: (value: ServeEnd) => void = () => undefined;
    const served: { port: ModelPort; platform: string }[] = [];
    serveShotModelProcess(parent, {
      platform: 'darwin',
      exit: (code) => exits.push(code),
      installNatives: (options) => {
        installed.push(options);
        return true;
      },
      serve: (modelPort, platform) => {
        served.push({ port: modelPort, platform });
        return new Promise((resolve) => (end = resolve));
      },
    });
    connect({ type: SHOT_MODEL_IPC.connect, componentsRoot: '/u/components', packaged: true }, [port()]);
    expect(installed).toEqual([{ componentsRoot: '/u/components', packaged: true, managedOnly: true }]);
    expect(served.map((s) => s.platform)).toEqual(['darwin']);
    expect(exits).toEqual([]);
    end('released');
    await vi.waitFor(() => expect(exits).toEqual([0]));
  });

  it('exits when main sends anything but a connect with a port, or never connects', () => {
    vi.useFakeTimers();
    try {
      const exits: number[] = [];
      const deps = { platform: 'darwin', exit: (code: number) => exits.push(code), connectMs: 500 };
      const bad = fakeParent();
      serveShotModelProcess(bad.parent, deps);
      bad.connect({ type: SHOT_MODEL_IPC.connect, componentsRoot: '/c', packaged: false }, []);
      serveShotModelProcess(fakeParent().parent, deps);
      vi.advanceTimersByTime(500);
      expect(exits).toEqual([1, 1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
