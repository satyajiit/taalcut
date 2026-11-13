// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type PerfSample, type PerfSystem } from './types';

const DEFAULT_SAMPLE: PerfSample = {
  indexMinutes: 30,
  previewMedianFps: 30,
  previewP5Fps: 28,
  droppedFrames: 0,
  renderSeconds: 55,
  memoryBytes: { main: 1, renderer: 1, agent: 1, jobs: 1, render: 1 },
};

/**
 * Fast fake sample. No ffmpeg and no hour of footage. Resolves on the next microtask.
 */
export function syntheticPerfSystem(sample?: Partial<PerfSample>): PerfSystem {
  const resolved: PerfSample = { ...DEFAULT_SAMPLE, ...sample };
  return {
    measure(): Promise<PerfSample> {
      return Promise.resolve(resolved);
    },
  };
}
