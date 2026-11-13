// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LNX1-TRM: the NVIDIA GPU setup card for each state the hardware report's gpuSetup can name, on its own: the restart
// after the libraries installed (no relaunch button: the app has none), a damaged install's Reinstall (the download's
// start), and nothing for the states another card or nobody speaks for. The guide table: Linux's pages and Ubuntu's
// steps, a Windows slot, nothing on a Mac. And whose a component is, in a sentence.
import { I18nProvider } from '@lingui/react';
import type { GpuSetup } from '@taalcut/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GPU_GUIDE_PAGES, GPU_GUIDES, gpuGuideFor, stepsFor } from '../../src/features/gpu-setup/gpu-guides';
import { GpuSetupCard, isGuided } from '../../src/features/gpu-setup/gpu-setup-card';
import { ownerBrand } from '../../src/features/gpu-setup/nvidia-terms';
import { activateLocale, i18n } from '../../src/i18n/i18n';

const SETUP = {
  gpuName: 'NVIDIA GeForce RTX 4090',
  driverVersion: '615.71.09',
  minDriver: '580',
  computeCapability: '8.9',
  minComputeCapability: '7.5',
  kernelDriver: 'nvidia',
  termsAccepted: true,
} as const;

beforeAll(() => activateLocale('en'));

function card(state: 'restart_needed' | 'runtime_damaged', onReinstall = () => {}) {
  return render(
    <I18nProvider i18n={i18n}>
      <GpuSetupCard setup={{ ...SETUP, state }} guide={undefined} onReinstall={onReinstall} />
    </I18nProvider>,
  );
}

describe('the NVIDIA GPU setup card', () => {
  it('after the libraries installed: restart, with no button, and what Taalcut does until then', () => {
    card('restart_needed');
    const region = screen.getByRole('region', { name: 'Restart Taalcut to use your GPU' });
    expect(region.textContent).toContain(
      'NVIDIA’s CUDA libraries are installed. Taalcut starts using them the next time it opens, so quit Taalcut and open it again.',
    );
    expect(region.textContent).toContain(
      'Until then, Taalcut keeps working on WebGPU or the CPU, more slowly.',
    );
    expect(region.querySelector('button')).toBeNull();
  });

  it('a damaged install: Reinstall starts the download, which fetches the libraries again', () => {
    const reinstall = vi.fn();
    card('runtime_damaged', reinstall);
    const region = screen.getByRole('region', { name: 'Reinstall NVIDIA’s CUDA libraries' });
    expect(region.textContent).toContain('Some of NVIDIA’s CUDA libraries are missing from their folder');
    fireEvent.click(screen.getByRole('button', { name: 'Reinstall' }));
    expect(reinstall).toHaveBeenCalledOnce();
  });

  it('speaks for the guided states only: the terms card has runtime_missing, ready needs nothing', () => {
    const states: GpuSetup['state'][] = [
      'no_driver',
      'driver_old',
      'gpu_too_old',
      'runtime_damaged',
      'restart_needed',
    ];
    for (const state of states) expect(isGuided(state), state).toBe(true);
    expect(isGuided('runtime_missing')).toBe(false);
    expect(isGuided('ready')).toBe(false);
  });
});

describe('the guides', () => {
  it('Linux has pages and Ubuntu’s steps; Windows a slot; a Mac none', () => {
    const linux = gpuGuideFor('linux');
    expect(linux?.driverLinks.map((link) => link.url)).toEqual([
      GPU_GUIDE_PAGES.ubuntuDrivers,
      GPU_GUIDE_PAGES.nvidiaDrivers,
    ]);
    expect(linux?.gpuLinks.map((link) => link.url)).toEqual([GPU_GUIDE_PAGES.cudaGpus]);
    expect(linux && stepsFor(linux, 'Ubuntu 24.04.5 LTS')?.command).toBe('sudo ubuntu-drivers install');
    expect(linux && stepsFor(linux, 'Fedora Linux 41 (Workstation Edition)')).toBeUndefined();
    expect(linux && stepsFor(linux, undefined)).toBeUndefined();
    expect(gpuGuideFor('windows')).toBeUndefined();
    expect(Object.keys(GPU_GUIDES)).toEqual(['linux', 'windows']);
    expect(gpuGuideFor('mac')).toBeUndefined();
  });

  it('names an owner as a sentence does', () => {
    expect(ownerBrand('NVIDIA Corporation')).toBe('NVIDIA');
    expect(ownerBrand('Example Inc.')).toBe('Example');
    expect(ownerBrand('Acme')).toBe('Acme');
  });
});
