// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- fake backend data (product names, ids, versions), never UI copy */

/**
 * NVIDIA's CUDA libraries in the fake download (LNX1-TRM), on the RTX 4090 host (`system: 'linux-nvidia'`): the
 * download holds `cuda-runtime-13` back until NVIDIA's terms are accepted (the fake acknowledgements, as the jobs
 * process reads the library's), saying what it would bring in; once they are, the next start fetches it. The
 * hardware report's gpuSetup follows: the libraries missing (terms accepted or not), then installed after the
 * app started (restart). The other NVIDIA machines' setups are fixed (fake-system.ts).
 */
import {
  componentTermsFeatureId,
  type Component,
  type ComponentTerms,
  type GpuSetup,
  type HardwareReport,
} from '@taalcut/core';
import { partComponent, type FakePart } from './fake-downloads-data';

const MB = 1000 ** 2;

export const FAKE_NVIDIA_TERMS: Omit<ComponentTerms, 'accepted'> = {
  owner: 'NVIDIA Corporation',
  termsVersion: '2026-10-27',
  documents: [
    { title: 'CUDA Toolkit End User License Agreement', url: 'https://docs.nvidia.com/cuda/eula/index.html' },
    {
      title: 'NVIDIA cuDNN Software License Agreement',
      url: 'https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html',
    },
  ],
};

/** tools/components/manifest.linux.provisional.json's cuda-runtime-13: CUDA 13.4.3's runtime libraries and cuDNN 9.27.0. */
export const FAKE_CUDA_RUNTIME: FakePart = {
  id: 'cuda-runtime-13',
  name: 'CUDA runtime 13',
  version: '13.4.3-cudnn9.27.0',
  licence: 'LicenseRef-NVIDIA-CUDA-Toolkit-EULA AND LicenseRef-NVIDIA-cuDNN',
  sizeBytes: 968.04 * MB,
  unpackedBytes: 2310 * MB,
  job: 'search',
  usedBy: [],
};

/** A part the download holds back until its owner's terms are accepted. */
export interface FakeHeld {
  readonly part: FakePart;
  readonly terms: Omit<ComponentTerms, 'accepted'>;
  /** What it brings in once accepted (the CUDA builds), as `awaitingTerms[].unlocks`. */
  readonly unlocks: readonly string[];
  readonly accepted: () => boolean;
}

export function fakeCudaHold(acknowledged: (featureId: string, termsVersion: string) => boolean): FakeHeld {
  return {
    part: FAKE_CUDA_RUNTIME,
    terms: FAKE_NVIDIA_TERMS,
    unlocks: ['local-llm-runtime-cuda', 'onnxruntime-cuda', 'whisper-server-cuda'],
    accepted: () =>
      acknowledged(componentTermsFeatureId(FAKE_CUDA_RUNTIME.id), FAKE_NVIDIA_TERMS.termsVersion),
  };
}

/** The held part as a row: not installed, its terms not accepted (or the download's row, with them accepted). */
export const heldComponent = (held: FakeHeld, status: Component['status'], accepted: boolean): Component => ({
  ...partComponent(held.part, status),
  terms: { ...held.terms, accepted },
});

/** The RTX 4090 host's setup now: the libraries to accept and download, then a restart to load them. */
export function liveCudaSetup(
  report: HardwareReport,
  held: FakeHeld,
  runtime: Component | undefined,
): GpuSetup {
  const gpu = report.info.gpus?.find((each) => each.vendor === 'nvidia');
  const installed = runtime?.status === 'installed';
  return {
    state: installed ? 'restart_needed' : 'runtime_missing',
    gpuName: gpu?.name ?? 'NVIDIA GPU',
    ...(gpu?.driverVersion ? { driverVersion: gpu.driverVersion } : {}),
    minDriver: '580',
    computeCapability: '8.9',
    minComputeCapability: '7.5',
    kernelDriver: 'nvidia',
    termsAccepted: held.accepted(),
  };
}
