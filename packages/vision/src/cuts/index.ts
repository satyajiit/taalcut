// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shot boundaries from TransNetV2 (IX2-C4): in-process, in a process of its own (IX2-S2) or on Core ML in the
 * mac helper (IX2-S10). Re-exported whole by the package's entry point (src/index.ts).
 */
export {
  SHOT_MODEL_DEVICES,
  shotModelDevices,
  shotModelOnCoreMl,
  shotModelRuntime,
  type ShotModelRuntime,
} from './backends';
export {
  TRANSNET_COMPONENT,
  TRANSNET_FILE,
  TRANSNET_FRAME,
  TRANSNET_OPERATION,
  transNetLoader,
  type ShotBoundaryModel,
} from './transnet';
export { remoteShotModel, type RemoteShotModel, type RemoteShotModelOptions } from './remote-model';
export type { ModelChannel, ModelTimers } from './model-session';
export { shotModelPool, type ModelPoolOptions, type ShotModelPool } from './model-pool';
export {
  coreMlShotModel,
  coreMlShotSession,
  SHOT_MODEL_UNITS,
  shotsServeArgs,
  TRANSNET_COREML_COMPONENT,
  type CoreMlShotModelOptions,
  type ShotModelUnits,
  type ShotsHelper,
} from './coreml-model';
export { developmentShotsHelper } from './coreml-development';
export { serveShotModel, serveTransNet, type ModelPort, type ServeEnd } from './model-serve';
export { childChannel, parentProcessPort, type ModelChild } from './model-channels';
export { streamPredictor, type BoundaryPredictions, type StreamPredictor } from './stream-predictor';
export { transitionsFrom, type Transition, type TransitionOptions } from './transitions';
export { WINDOW_CONTEXT, WINDOW_FRAMES, WINDOW_STEP, windowedPredictor, type WindowModel } from './windows';
