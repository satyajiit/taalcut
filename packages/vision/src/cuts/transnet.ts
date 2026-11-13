// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TransNetV2 (Souček and Lokoč 2020, github.com/soCzech/TransNetV2, MIT code and weights) as ONNX through
 * vision's runtime: a window of 100 RGB frames at 48×27, floats 0–255 (the graph divides by 255 itself), in;
 * per frame, the single-frame head (a shot's last frame before a transition) and the many-hot head (inside
 * a transition) out, each after its sigmoid. The file and its provenance: the vision SPEC, "Shot boundaries".
 * Opening it loads the session once; a failed open (`vision.shot_model_failed`) is tried again on the next call.
 */
import { join } from 'node:path';
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type ComputeBackend,
  type TaalcutError,
} from '@taalcut/core';
import { ShotModelFailed } from '../errors';
import type { OnnxRuntime, OnnxSession, OnnxTensor } from '../onnx/ort';
import { WINDOW_FRAMES, type WindowModel, type WindowOutput } from './windows';

/** The component that holds the model, and its file. */
export const TRANSNET_COMPONENT = 'transnetv2';
export const TRANSNET_FILE = 'transnetv2.onnx';
/** Its frames: exactly this size, aspect ignored. */
export const TRANSNET_FRAME = { width: 48, height: 27 } as const;
/** The `compute.fallback` operation name. */
export const TRANSNET_OPERATION = 'vision.shotBoundaries';

export interface ShotBoundaryModel extends WindowModel {
  /** The model, for documents and outputs that name it. */
  readonly id: string;
  readonly backend: ComputeBackend;
  release(): Promise<void>;
}

const INPUT_DIMS = [1, WINDOW_FRAMES, TRANSNET_FRAME.height, TRANSNET_FRAME.width, 3] as const;

function head(outputs: Record<string, OnnxTensor>, name: string | undefined): Float32Array | undefined {
  const tensor = name === undefined ? undefined : outputs[name];
  if (!tensor || tensor.data.length !== WINDOW_FRAMES) return undefined;
  return tensor.data;
}

function wrap(session: OnnxSession): AsyncResult<ShotBoundaryModel> {
  const [input] = session.inputNames;
  // The export names its outputs by node number: the single-frame head first, then many-hot (checked
  // against upstream's TF model, the vision SPEC).
  const [singleName, manyHotName] = session.outputNames;
  if (input === undefined || manyHotName === undefined)
    return Promise.resolve(
      err(
        ShotModelFailed(undefined, {
          detail: `unexpected graph: ${session.inputNames} → ${session.outputNames}`,
        }),
      ),
    );
  return Promise.resolve(
    ok({
      id: TRANSNET_COMPONENT,
      backend: session.backend,
      async predict(window: Float32Array, signal?: AbortSignal): AsyncResult<WindowOutput> {
        if (signal?.aborted) return err(CancelledError());
        const run = await session.run({ [input]: { data: window, dims: INPUT_DIMS } }, signal);
        if (!run.ok)
          return run.error.code === 'core.cancelled'
            ? run
            : err(ShotModelFailed(undefined, { detail: `${run.error.code}: ${run.error.detail ?? ''}` }));
        const single = head(run.value, singleName);
        const manyHot = head(run.value, manyHotName);
        if (!single || !manyHot)
          return err(ShotModelFailed(undefined, { detail: 'outputs are not 100 frames' }));
        return ok({ single, manyHot });
      },
      release: () => session.release(),
    }),
  );
}

/** Opens the model from its component folder, once; the same model for every caller after that. */
export function transNetLoader(
  onnx: OnnxRuntime,
  modelDir: () => Promise<string | null>,
): (signal?: AbortSignal) => AsyncResult<ShotBoundaryModel> {
  let loading: Promise<ShotBoundaryModel | TaalcutError> | undefined;
  const open = async (signal?: AbortSignal): AsyncResult<ShotBoundaryModel> => {
    const dir = await modelDir();
    if (dir === null)
      return err(ShotModelFailed(undefined, { detail: `${TRANSNET_COMPONENT} is not installed` }));
    const session = await onnx.openSession(join(dir, TRANSNET_FILE), {
      operation: TRANSNET_OPERATION,
      ...(signal ? { signal } : {}),
    });
    if (session.ok) return wrap(session.value);
    // The runtime's own code names OCR, its first user: a session that won't open is this model failing.
    return session.error.code === 'core.cancelled'
      ? session
      : err(ShotModelFailed(undefined, { detail: `${session.error.code}: ${session.error.detail ?? ''}` }));
  };
  return async (signal) => {
    loading ??= open(signal).then((r) => (r.ok ? r.value : r.error));
    const loaded = await loading;
    if ('predict' in loaded) return ok(loaded);
    loading = undefined;
    return err(loaded);
  };
}
