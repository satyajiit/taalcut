// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-ONB: the processor's and the GPU's makers, by mark and in words, in Settings › About (UX4: first run no longer
// shows the hardware; Taalcut checks it quietly and the details stay in Settings).
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { freshMac } from '../onboarding/onboarding-dom';
import { renderWith } from '../onboarding/render-with';

describe('Settings › This Mac › the makers’ marks', () => {
  it('the processor and the graphics facts carry their makers’ marks', async () => {
    await renderWith(
      '/settings/this-mac',
      freshMac({ phase3: { hardware: { system: 'linux-amd' } } }),
      {},
      { platform: 'linux' },
    );
    await screen.findByText('AMD Ryzen 9 7950X 16-Core Processor');
    const names = [...document.querySelectorAll<HTMLElement>('[data-slot=chip-name]')];
    expect(names.map((name) => name.dataset.vendor)).toEqual(['amd', 'amd']);
    expect(
      names.map((name) => name.querySelector('[data-slot=chip-mark]')?.getAttribute('data-vendor')),
    ).toEqual(['amd', 'amd']);
  });
});
