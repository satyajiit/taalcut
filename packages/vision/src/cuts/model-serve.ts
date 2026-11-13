// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The model's side of its own process (IX2-S2, the app's out/utility/shot-model.mjs, the eval's Node child and
 * thread): waits for `open`, opens the model once and says whether it is ready, then runs windows one at a time
 * in the order they arrive. It ends when the client releases it or goes away (a closed port, a parent that
 * died), and the entry then exits, so a model process never outlives the jobs process that asked for it. It
 * opens no video and holds no VideoToolbox session: ending it never touches the hardware decoder.
 */
import { createSerialQueue, toTaalcutError, type AsyncResult } from '@taalcut/core';
import { createOrtRuntime } from '../onnx/ort';
import { shotModelDevices, type ShotModelRuntime } from './backends';
import { toModelSchema, type FromModel, type ToModel } from './model-protocol';
import { transNetLoader, type ShotBoundaryModel } from './transnet';

/** The model's end of its channel to the client. */
export interface ModelPort {
  send(message: FromModel): void;
  onMessage(listener: (raw: unknown) => void): void;
  /** Once, when the client is gone. */
  onGone(listener: () => void): void;
}

/** How the session ended: released by the client, or the client went away. */
export type ServeEnd = 'released' | 'gone';

export function serveShotModel(
  port: ModelPort,
  open: (modelDir: string, runtime: Partial<ShotModelRuntime>) => AsyncResult<ShotBoundaryModel>,
): Promise<ServeEnd> {
  let opened: AsyncResult<ShotBoundaryModel> | undefined;
  /** Messages one at a time, in the order they came. */
  const messages = createSerialQueue();
  return new Promise((end) => {
    const handle = async (message: ToModel) => {
      if (message.type === 'open') {
        if (opened) return;
        const { modelDir, devices, cudaDeviceId, disableGpu } = message;
        opened = open(modelDir, {
          ...(devices ? { devices } : {}),
          ...(cudaDeviceId !== undefined ? { cudaDeviceId } : {}),
          ...(disableGpu ? { disableGpu } : {}),
        });
        const model = await opened;
        port.send(
          model.ok
            ? { type: 'ready', model: model.value.id, backend: model.value.backend }
            : { type: 'failed', error: model.error },
        );
        return;
      }
      const model = await opened;
      if (message.type === 'release') {
        if (model?.ok) await model.value.release();
        port.send({ type: 'released' });
        end('released');
        return;
      }
      if (!model?.ok) return;
      const out = await model.value.predict(message.window);
      port.send(
        out.ok
          ? { type: 'output', id: message.id, single: out.value.single, manyHot: out.value.manyHot }
          : { type: 'error', id: message.id, error: out.error },
      );
    };
    port.onMessage((raw) => {
      const parsed = toModelSchema.safeParse(raw);
      if (!parsed.success) return;
      // A message whose handling throws (a release the runtime refused) is the model failing: the client ends
      // its session, and the messages after it are still answered.
      void messages
        .run(() => handle(parsed.data))
        .catch((cause: unknown) => port.send({ type: 'failed', error: toTaalcutError(cause) }));
    });
    port.onGone(() => end('gone'));
  });
}

/**
 * TransNetV2 on the providers the open message names (the jobs process's probe), else `platform`'s row; its CPU
 * fallback sent back for the jobs process's bus.
 */
export function serveTransNet(port: ModelPort, platform: string): Promise<ServeEnd> {
  return serveShotModel(port, (modelDir, runtime) => {
    const onnx = createOrtRuntime({
      devices: runtime.devices ?? shotModelDevices(platform),
      ...(runtime.cudaDeviceId !== undefined ? { cuda: { deviceId: runtime.cudaDeviceId } } : {}),
      ...(runtime.disableGpu ? { disableGpu: true } : {}),
      onFallback: (event) => port.send({ type: 'fallback', event }),
    });
    return transNetLoader(onnx, async () => modelDir)();
  });
}
