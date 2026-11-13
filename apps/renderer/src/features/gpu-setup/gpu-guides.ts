// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the NVIDIA GPU setup card points someone whose NVIDIA driver is missing or too old (LNX1-TRM), per platform:
 * Linux now (Ubuntu's Additional Drivers or `ubuntu-drivers`, then a restart, and the pages behind them); a Windows
 * slot for when Taalcut ships CUDA there; nothing on a Mac, which has no NVIDIA GPU to set up. Each page was opened
 * with a GET on 27 Oct 2026 and is on core's EXTERNAL_LINK_HOSTS, so it opens in the browser through main.
 *
 * Taalcut never runs the command: the card shows it with a copy button. The driver is NVIDIA's, installed through
 * the system; the CUDA libraries are NVIDIA's too, installed by Taalcut once the person accepts NVIDIA's terms.
 */
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { HostPlatform } from '@taalcut/ui';

export const GPU_GUIDE_PAGES = {
  /** Ubuntu Server documentation, "NVIDIA drivers installation" (documentation.ubuntu.com redirects here). */
  ubuntuDrivers: 'https://ubuntu.com/server/docs/how-to/graphics/install-nvidia-drivers/',
  nvidiaDrivers: 'https://www.nvidia.com/en-us/drivers/',
  /** "CUDA GPU Compute Capability" (developer.nvidia.com/cuda-gpus redirects here). */
  cudaGpus: 'https://developer.nvidia.com/cuda/gpus',
} as const;

export interface GpuGuideLink {
  readonly url: string;
  readonly label: MessageDescriptor;
}

/** The distribution steps for, by how the OS names itself (the probe's osName, e.g. 'Ubuntu 24.04.5 LTS'). */
export interface GpuGuideSteps {
  readonly distro: RegExp;
  /** The system's own way, in words. `{minDriver}`: CUDA 13's oldest driver. */
  readonly settings: MessageDescriptor;
  /** The terminal way: shown, with a copy button, never run. */
  readonly command: string;
  readonly then: MessageDescriptor;
}

export interface GpuGuide {
  readonly steps: readonly GpuGuideSteps[];
  /** Installing or updating the driver. */
  readonly driverLinks: readonly GpuGuideLink[];
  /** Which GPUs CUDA runs on. */
  readonly gpuLinks: readonly GpuGuideLink[];
}

const NVIDIA_DRIVERS: GpuGuideLink = {
  url: GPU_GUIDE_PAGES.nvidiaDrivers,
  label: msg`NVIDIA’s driver downloads`,
};

const LINUX: GpuGuide = {
  steps: [
    {
      distro: /^ubuntu\b/i,
      settings: msg({
        message:
          'Open Software & Updates › Additional Drivers and pick the recommended NVIDIA driver ({minDriver} or newer).',
      }),
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a command, typed as is
      command: 'sudo ubuntu-drivers install',
      then: msg`Then restart the computer and open Taalcut again.`,
    },
  ],
  driverLinks: [
    { url: GPU_GUIDE_PAGES.ubuntuDrivers, label: msg`Ubuntu’s guide to NVIDIA drivers` },
    NVIDIA_DRIVERS,
  ],
  gpuLinks: [{ url: GPU_GUIDE_PAGES.cudaGpus, label: msg`NVIDIA’s list of CUDA GPUs` }],
};

/** The guides by host platform: Linux now, Windows once Taalcut ships CUDA there, never a Mac. */
export const GPU_GUIDES: { readonly [P in Exclude<HostPlatform, 'mac'>]: GpuGuide | undefined } = {
  linux: LINUX,
  windows: undefined,
};

export function gpuGuideFor(platform: HostPlatform): GpuGuide | undefined {
  return platform === 'mac' ? undefined : GPU_GUIDES[platform];
}

/** The steps for this OS, when the guide has some (Ubuntu); other distributions get the links only. */
export function stepsFor(guide: GpuGuide, osName: string | undefined): GpuGuideSteps | undefined {
  return osName === undefined ? undefined : guide.steps.find((steps) => steps.distro.test(osName));
}
