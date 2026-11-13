// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LNX1-SHL: Settings › This Mac (UX4 set: General's view; was About) on the Linux fixtures (fake-system.ts): the RTX 4090 host and the same host with its
// GPU hidden. "This computer" off a Mac, the OS by its own name, the GPU with its memory and driver, and every CPU
// fallback in words, never the unknown reason.
import { i18n } from '@lingui/core';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { primaryGpu } from '../../src/features/settings/about/local-compute';
import { describeError, translateKey } from '../../src/features/settings/model-messages';
import { LINUX_NVIDIA_HARDWARE } from '../../src/backend/fake/fake-system';
import { activateLocale } from '../../src/i18n/i18n';
import { renderApp } from '../render-app';

/** The definition list's facts by name: "Processor" → "13th Gen …". */
async function facts(list: string): Promise<Record<string, string>> {
  const dl = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(`dl[aria-label="${list}"]`);
    if (!found || found.querySelectorAll('dt').length < 2) throw new Error(`no ${list} facts yet`);
    return found;
  });
  return Object.fromEntries(
    [...dl.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? '']),
  );
}

describe('Settings › About on Linux with an NVIDIA GPU', () => {
  it('is “This computer”, with the processor, the GPU’s memory and driver, and Ubuntu by name', async () => {
    await renderApp(
      '/settings/this-mac',
      { phase3: { hardware: { system: 'linux-nvidia' } } },
      'en',
      'linux',
    );
    const found = await facts('This computer');
    expect(found['Processor']).toBe('13th Gen Intel(R) Core(TM) i9-13900K');
    expect(found['Graphics']).toBe('NVIDIA GeForce RTX 4090 · 24 GB · CUDA · driver 615.71.09');
    expect(found['System']).toBe('Ubuntu 24.04.5 LTS');
    expect(found['Memory']).toBe('64 GB');
    expect(found['Cores']).toBe('32 CPU');
    expect(Object.keys(found)).not.toContain('Chip');
    expect(Object.keys(found)).not.toContain('macOS');
    const section = screen.getByRole('region', { name: 'Hardware' });
    expect(section.textContent).toContain('High tier');
    expect(section.textContent).not.toMatch(/\bMac\b/);
  });

  it('says where each job runs on this computer: CUDA, WebGPU, whisper.cpp on the GPU', async () => {
    await renderApp(
      '/settings/this-mac',
      { phase3: { hardware: { system: 'linux-nvidia' } } },
      'en',
      'linux',
    );
    const compute = await screen.findByRole('region', { name: 'Where work runs on this computer' });
    expect(within(compute).getAllByText('GPU (CUDA)').length).toBeGreaterThan(1);
    expect(within(compute).getByText('GPU (WebGPU)')).toBeTruthy();
    expect(compute.textContent).not.toContain('The GPU couldn’t be used.');
  });
});

describe('Settings › About on Linux with no GPU for models', () => {
  it('says why the tier is Minimum, shows no Graphics fact, and names the CPU fallback', async () => {
    await renderApp('/settings/this-mac', { phase3: { hardware: { system: 'linux-cpu' } } }, 'en', 'linux');
    const found = await facts('This computer');
    expect(found['Graphics']).toBeUndefined();
    const section = screen.getByRole('region', { name: 'Hardware' });
    expect(section.textContent).toContain('Minimum tier');
    expect(section.textContent).toContain(
      'Taalcut found no graphics chip it can run models on, so local models run on the processor and more work goes to cloud models.',
    );
    const compute = await screen.findByRole('region', { name: 'Where work runs on this computer' });
    expect(
      within(compute).getAllByText(
        'Taalcut found no graphics chip it can run this on, so it runs on the CPU.',
      ),
    ).toHaveLength(2);
    expect(compute.textContent).not.toContain('The GPU couldn’t be used.');
  });
});

describe('Settings › About on a Mac', () => {
  it('is still “This Mac”, with the chip and macOS', async () => {
    await renderApp('/settings/this-mac');
    const found = await facts('This Mac');
    expect(found['Chip']).toBe('Apple M2 Pro');
    expect(found['macOS']).toBe('26.0.1');
    expect(found['Graphics']).toBe('Apple M2 Pro · 16-core GPU · Metal 3');
  });
});

describe('the words for the backend’s keys off a Mac', () => {
  it('a probe that failed names this computer, and every core fallback reason has words', async () => {
    await activateLocale('en');
    const probe = { messageKey: 'errors.models.hardware_probe_failed' };
    expect(describeError(i18n, probe)).toBe('Couldn’t read this Mac’s hardware.');
    expect(describeError(i18n, probe, 'linux')).toBe('Couldn’t read this computer’s hardware.');
    const lacks = 'models.compute.cpuReason.hardware_lacks_backend';
    const unknown = { id: 'x', message: 'unknown' };
    expect(translateKey(i18n, lacks, unknown, 'linux')).toBe('This computer has no GPU this model can use.');
    expect(translateKey(i18n, lacks, unknown)).toBe('This Mac has no GPU this model can use.');
    expect(describeError(i18n, { messageKey: 'errors.desktop.keyring_unavailable' })).toMatch(
      /system keyring.*GNOME Keyring or KWallet/,
    );
    for (const reason of [
      'no_accelerator',
      'unsupported_input',
      'accelerator_failed',
      'out_of_memory',
      'disabled',
      'no_gpu_kernels',
      'gpu_unsupported',
      'gpu_out_of_memory',
      'gpu_failed_at_runtime',
    ]) {
      expect(translateKey(i18n, `compute.fallback.${reason}`, unknown, 'linux'), reason).not.toBe('unknown');
    }
    for (const key of ['os_too_old', 'gpu_driver_old', 'no_gpu_for_local_models', 'not_apple_silicon']) {
      expect(translateKey(i18n, `models.hardware.${key}`, unknown), key).not.toBe('unknown');
    }
  });

  it('the Graphics fact falls back to the probe’s first GPU when the compute report has none', () => {
    expect(primaryGpu(undefined, LINUX_NVIDIA_HARDWARE.info.gpus)).toEqual({
      name: 'NVIDIA GeForce RTX 4090',
      api: 'CUDA',
      vramBytes: 24 * 1024 ** 3,
      driverVersion: '615.71.09',
    });
    expect(primaryGpu(undefined, [])).toBeUndefined();
    expect(primaryGpu({ name: 'Apple M2 Pro', cores: 16 }, LINUX_NVIDIA_HARDWARE.info.gpus)?.name).toBe(
      'Apple M2 Pro',
    );
  });
});
