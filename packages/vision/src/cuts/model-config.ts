// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TransNetV2's settings (`VISION_CONFIG.shots.model`; measured: the vision SPEC, "Shot boundaries").
 *
 * Its frames are every n-th grid frame, n the whole number that brings the stream nearest `maxFps` (it was
 * trained on footage around 25 fps; 15 would halve its cost but missed 3 of ix-v1's 65 cuts). A run of
 * single-frame probabilities over `threshold` (upstream's 0.5) is a transition: a hard cut on the frame inside
 * it where scdet scores at least `cutScore` (at most 2.5 inside every ix-v1 dissolve), else gradual when the
 * many-hot head marks at least `gradualFrames` stream frames, else a cut after the run (cuts/transitions.ts).
 *
 * Its own process (IX2-S2, S10: the mac helper's Core ML `shots` service, else the ONNX model's utility process)
 * ends after `idleMs` without a window, and may take `startMs` to say its model is ready (about a second when the
 * Mac is quiet) before the job falls back. On Core ML it runs on `computeUnits` (cuts/coreml-model.ts): the GPU,
 * where the fp32 model gives the ONNX model's transitions exactly (the Neural Engine computes in fp16; vision SPEC,
 * "Shot boundaries on Core ML").
 */
export const SHOT_MODEL_CONFIG = {
  maxFps: 30,
  threshold: 0.5,
  gradualFrames: 10,
  cutScore: 8,
  idleMs: 120_000,
  startMs: 30_000,
  computeUnits: 'cpuAndGPU',
} as const;
