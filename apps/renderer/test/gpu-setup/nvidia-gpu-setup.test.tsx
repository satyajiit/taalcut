// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LNX1-TRM (UX4: in first run, the last step's Kaatu moment asks for the terms, its card a press away): before
// anything of NVIDIA's downloads, the window says whose its CUDA libraries are, that NVIDIA licenses
// them to the person and that Taalcut only downloads and installs them, and links NVIDIA's terms. Accepting records
// the acknowledgement where the jobs process reads it and starts the download, which brings the libraries in; "Not
// now" leaves the download on the builds that run without them. Settings › Models keeps the choice, and once they
// are installed says whose they are; About lists the same. The other NVIDIA states guide the person: a restart, a
// newer driver, NVIDIA's driver at all, or a GPU CUDA 13 dropped.
import { CHATGPT_PROVIDER, componentTermsFeatureId } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeSystem } from '../../src/backend/fake/fake-system';
import { el, freshMac } from '../onboarding/onboarding-dom';
import { renderWith } from '../onboarding/render-with';

const onLinux = { platform: 'linux' as const };
const ACCEPTED = [componentTermsFeatureId('cuda-runtime-13'), '2026-10-27'] as const;
const TERMS_CARD = 'Use your NVIDIA GPU for local models';

/** First run's last step with something that can think, the terms' moment opened. */
async function firstRun(system: FakeSystem) {
  const app = await renderWith(
    '/onboarding/first-video',
    freshMac({ phase3: { hardware: { system } } }),
    {},
    onLinux,
  );
  await act(async () => {
    await app.controls.accounts.signIn(CHATGPT_PROVIDER);
  });
  await waitFor(() => el('[data-slot=quiet-check][data-need=terms]'));
  await act(async () => {
    fireEvent.click(el('[data-action="quiet-check-open"]'));
  });
  return app;
}
const settings = (path: string, system: FakeSystem) =>
  renderWith(
    path,
    { phase2b: { onboarding: { downloadTickMs: 0 } }, phase3: { hardware: { system } } },
    {},
    onLinux,
  );
const ids = (list: readonly { id: string }[]) => list.map((each) => each.id);

describe("NVIDIA's terms, in first run on the RTX 4090 host", () => {
  it('says whose the libraries are, with their size and the GPU, and links each of NVIDIA’s terms', async () => {
    const { controls } = await firstRun('linux-nvidia');
    const card = await screen.findByRole('region', { name: TERMS_CARD });
    const text = card.textContent ?? '';
    expect(text).toMatch(
      /Taalcut can download NVIDIA’s CUDA libraries \(\d+(\.\d+)?\s(MB|GB)\) so its models/,
    );
    expect(text).toContain('so its models run on your NVIDIA GeForce RTX 4090.');
    expect(text).toContain(
      'These libraries are made and owned by NVIDIA Corporation, and NVIDIA licenses them to you under its own terms. Taalcut doesn’t own, change or sell them. It only downloads and installs them on this computer so it can use your GPU.',
    );
    expect(text).toContain('To install them, you accept NVIDIA’s terms:');
    const eula = within(card).getByRole('link', { name: /CUDA Toolkit End User License Agreement/ });
    expect(eula.getAttribute('href')).toBe('https://docs.nvidia.com/cuda/eula/index.html');
    const cudnn = within(card).getByRole('link', { name: /NVIDIA cuDNN Software License Agreement/ });
    expect(cudnn.getAttribute('href')).toBe(
      'https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html',
    );
    expect(text).toContain(
      'Everything still works, more slowly. You can install them later in Settings › Models.',
    );
    // The download of everything else started without them.
    await waitFor(() => expect(controls.onboarding.downloads().state).toBe('ready'));
    expect(ids(controls.onboarding.downloads().components)).not.toContain('cuda-runtime-13');
    expect(controls.onboarding.downloads().awaitingTerms?.[0]?.unlocks).toContain('onnxruntime-cuda');
  });

  it('Accept and install records NVIDIA’s terms and re-plans: the libraries download, then a restart', async () => {
    const { controls } = await firstRun('linux-nvidia');
    const card = await screen.findByRole('region', { name: TERMS_CARD });
    await waitFor(() => expect(controls.onboarding.downloads().state).toBe('ready'));
    fireEvent.click(within(card).getByRole('button', { name: 'Accept and install' }));
    await waitFor(() => expect(controls.phase3.acknowledgements.has(...ACCEPTED)).toBe(true));
    await waitFor(() => expect(ids(controls.onboarding.downloads().components)).toContain('cuda-runtime-13'));
    expect(controls.onboarding.downloads()).not.toHaveProperty('awaitingTerms');
    expect(controls.dispatched.map((each) => each.name)).toContain('components.download');
    const restart = await screen.findByRole('region', { name: 'Restart Taalcut to use your GPU' });
    expect(restart.textContent).toContain('NVIDIA’s CUDA libraries are installed.');
    expect(screen.queryByRole('region', { name: TERMS_CARD })).toBeNull();
  });

  it('Not now leaves the download on the builds that run without them, and asks nothing more', async () => {
    const { controls } = await firstRun('linux-nvidia');
    const card = await screen.findByRole('region', { name: TERMS_CARD });
    fireEvent.click(within(card).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: TERMS_CARD })).toBeNull());
    // Kaatu stops asking: the moment moves on to the video.
    await waitFor(() => expect(document.querySelector('[data-slot=quiet-check]')).toBeNull());
    await waitFor(() => expect(controls.onboarding.downloads().state).toBe('ready'));
    expect(controls.phase3.acknowledgements.has(...ACCEPTED)).toBe(false);
    expect(ids(controls.onboarding.downloads().components)).not.toContain('cuda-runtime-13');
  });

  it('asks nothing on a Mac or a Linux PC without NVIDIA', async () => {
    const { controls } = await renderWith('/onboarding/first-video', freshMac());
    await act(async () => {
      await controls.accounts.signIn(CHATGPT_PROVIDER);
    });
    await waitFor(() => expect(controls.onboarding.downloads().state).toBe('ready'));
    expect(document.querySelector('[data-slot=quiet-check]')).toBeNull();
    expect(document.querySelector('[data-slot=nvidia-terms], [data-slot=gpu-setup]')).toBeNull();
    expect(screen.queryByText(/NVIDIA/)).toBeNull();
  });
});

describe('Settings › Models › Downloads and This Mac on the RTX 4090 host', () => {
  it('offers the terms on the CUDA runtime’s row, and after them says whose it is', async () => {
    const { controls } = await settings('/settings/models/downloads', 'linux-nvidia');
    const row = await waitFor(() => el('[data-slot=cuda-runtime-row]'));
    expect(row.textContent).toMatch(/^CUDA runtime 13Not installed · .+ · waits for NVIDIA’s terms/);
    fireEvent.click(within(row).getByRole('button', { name: 'Review terms and install' }));
    const card = await screen.findByRole('region', { name: TERMS_CARD });
    fireEvent.click(within(card).getByRole('button', { name: 'Accept and install' }));
    await waitFor(() => expect(controls.phase3.acknowledgements.has(...ACCEPTED)).toBe(true));
    await waitFor(() =>
      expect(el('[data-slot=cuda-runtime-row] [data-slot=ownership]').textContent).toBe(
        '© NVIDIA Corporation · licensed to you by NVIDIA · installed by Taalcut at your request',
      ),
    );
    const accepted = el('[data-slot=cuda-runtime-row]');
    expect(
      within(accepted).getByRole('link', { name: /CUDA Toolkit End User License Agreement/ }),
    ).toBeTruthy();
  });

  it('closes the card with Not now and keeps the row', async () => {
    await settings('/settings/models/downloads', 'linux-nvidia');
    const row = await waitFor(() => el('[data-slot=cuda-runtime-row]'));
    fireEvent.click(within(row).getByRole('button', { name: 'Review terms and install' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: TERMS_CARD })).toBeNull());
    expect(
      within(el('[data-slot=cuda-runtime-row]')).getByRole('button', { name: 'Review terms and install' }),
    );
  });

  it('This Mac lists the CUDA runtime with whose it is', async () => {
    await settings('/settings/this-mac', 'linux-nvidia');
    const row = await waitFor(() => el('li[data-component="cuda-runtime-13"]'));
    expect(row.querySelector('[data-slot=ownership]')?.textContent).toBe(
      '© NVIDIA Corporation · licensed to you by NVIDIA',
    );
  });
});

describe('the NVIDIA GPU setup on machines that need something else', () => {
  // UX4: a driver to update or install doesn't hold anything (Taalcut works without CUDA, more slowly), so first run
  // doesn't ask: Settings › Models and About say it.
  it('an old driver: update to 580 or newer, the version it has, then Ubuntu’s steps and the pages', async () => {
    await settings('/settings/models/downloads', 'linux-nvidia-old-driver');
    const card = await screen.findByRole('region', { name: 'Update your NVIDIA driver to 580 or newer' });
    expect(card.textContent).toContain(
      'Your NVIDIA GeForce RTX 3060 has NVIDIA’s driver 550.120. NVIDIA’s CUDA libraries need driver 580 or newer.',
    );
    expect(card.textContent).toContain('Taalcut keeps working on WebGPU or the CPU, more slowly.');
    expect(card.textContent).toContain(
      'Open Software & Updates › Additional Drivers and pick the recommended NVIDIA driver (580 or newer).',
    );
    expect(within(card).getByText('sudo ubuntu-drivers install').tagName).toBe('CODE');
    expect(within(card).getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(card.textContent).toContain('Then restart the computer and open Taalcut again.');
    const links = within(card)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(links).toEqual([
      'https://ubuntu.com/server/docs/how-to/graphics/install-nvidia-drivers/',
      'https://www.nvidia.com/en-us/drivers/',
    ]);
    expect(screen.queryByRole('region', { name: TERMS_CARD })).toBeNull();
  });

  it('no NVIDIA driver (nouveau): install NVIDIA’s driver, why CUDA can’t run, and the guide', async () => {
    await settings('/settings/models/downloads', 'linux-nouveau');
    const card = await screen.findByRole('region', { name: 'Install NVIDIA’s driver to use your GPU' });
    expect(card.textContent).toContain(
      'This computer has NVIDIA GA102 [GeForce RTX 3080], but NVIDIA’s driver isn’t loaded, so Taalcut can’t use CUDA. It runs on the open-source nouveau driver, which CUDA doesn’t work with.',
    );
    expect(within(card).getByText('sudo ubuntu-drivers install')).toBeTruthy();
    expect(card.textContent).toContain('The driver is NVIDIA’s, and your system installs it.');
  });

  it('a GPU before Turing: CUDA 13 needs a newer one, it still works through Vulkan or WebGPU', async () => {
    await settings('/settings/this-mac', 'linux-pascal');
    const card = await screen.findByRole('region', { name: 'Your GPU is too old for CUDA' });
    expect(card.textContent).toContain(
      'NVIDIA’s CUDA 13 needs a Turing GPU (GeForce GTX 16 or RTX 20 series) or newer. Your NVIDIA GeForce GTX 1080 has compute capability 6.1, below 7.5.',
    );
    expect(card.textContent).toContain('Taalcut still uses it through Vulkan or WebGPU where it can');
    expect(
      within(card)
        .getByRole('link', { name: /NVIDIA’s list of CUDA GPUs/ })
        .getAttribute('href'),
    ).toBe('https://developer.nvidia.com/cuda/gpus');
    expect(within(card).queryByText('sudo ubuntu-drivers install')).toBeNull();
  });

  it('the same card in Settings › Models', async () => {
    await settings('/settings/models/downloads', 'linux-nvidia-old-driver');
    await screen.findByRole('region', { name: 'Update your NVIDIA driver to 580 or newer' });
    expect(document.querySelector('[data-slot=cuda-runtime-row]')).toBeNull();
  });
});
