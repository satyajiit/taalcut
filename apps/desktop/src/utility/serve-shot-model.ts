// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the shot model's process does (shot-model.ts, IX2-S2), with Electron and `process` injected so it is
 * unit-tested: wait for main's connect message and its port, install ONNX Runtime's binding from the
 * onnxruntime component (component-natives.ts), serve TransNetV2 on the port, and exit once the jobs process
 * releases the model or goes away. A process that main started but never connected exits after `connectMs`.
 */
import type { EmitterPort } from '@taalcut/core';
import { serveTransNet, type ModelPort, type ServeEnd } from '@taalcut/vision';
import { shotModelConnectSchema } from '../shared/shot-model-ipc';
import { installComponentNatives } from './component-natives';
import { managedNativesOnly } from './roots/dev-components';
import { modelPort } from './shot-model-port';

/** The part of Electron's `process.parentPort` used here. */
export interface ModelParentPort {
  once(
    event: 'message',
    listener: (event: { data: unknown; ports: readonly EmitterPort[] }) => void,
  ): unknown;
}

export interface ShotModelProcessDeps {
  readonly platform: string;
  readonly exit: (code: number) => void;
  /** Default 30 s. */
  readonly connectMs?: number;
  /** Default: vision's TransNetV2 on `platform`'s providers. */
  readonly serve?: (port: ModelPort, platform: string) => Promise<ServeEnd>;
  /** Default: component-natives.ts. */
  readonly installNatives?: typeof installComponentNatives;
}

export function serveShotModelProcess(parent: ModelParentPort, deps: ShotModelProcessDeps): void {
  const serve = deps.serve ?? serveTransNet;
  const install = deps.installNatives ?? installComponentNatives;
  const unconnected = setTimeout(() => {
    console.error('[shot-model] main never connected');
    deps.exit(1);
  }, deps.connectMs ?? 30_000);
  parent.once('message', (event) => {
    clearTimeout(unconnected);
    const connect = shotModelConnectSchema.safeParse(event.data);
    const [port] = event.ports;
    if (!connect.success || !port) {
      console.error('[shot-model] not a connect message');
      deps.exit(1);
      return;
    }
    install({
      componentsRoot: connect.data.componentsRoot,
      packaged: connect.data.packaged,
      managedOnly: managedNativesOnly(connect.data.packaged),
    });
    // Released or left: both are a normal end.
    void serve(modelPort(port), deps.platform).then(() => deps.exit(0));
  });
}
