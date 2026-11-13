// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { buildHallmarkThumbnailPrompt } from '../src/images/thumbnail-hallmark';
import { generateThumbnailInput, generateThumbnailKey } from '../src/images/thumbnail-tool-io';

describe('brief-directed thumbnail artwork', () => {
  it('preserves illustration direction without forcing a photograph or unrequested optical effects', () => {
    const prompt = buildHallmarkThumbnailPrompt({
      prompt: 'Orange hand-drawn flight path over a cream map',
      medium: 'illustration',
    });
    expect(prompt).toContain('Requested medium: illustration');
    expect(prompt).toContain('Orange hand-drawn flight path');
    expect(prompt).not.toMatch(/photorealistic|shallow depth|film grain/);
    expect(prompt).toContain('editable cover design layers');
  });

  it('honors an explicit full composition including exact lettering and supplied branding', () => {
    const prompt = buildHallmarkThumbnailPrompt({
      prompt: 'Oversized headline with an orange underline and drawn flight path',
      medium: 'mixed',
      composition: 'complete',
      hookText: 'Never gets old.',
      branding: '@taalcut.app',
    });
    expect(prompt).toContain('Exact headline: "Never gets old."');
    expect(prompt).toContain('Supplied branding: "@taalcut.app"');
    expect(prompt).toContain('complete composition');
    expect(prompt).not.toContain('Keep the backdrop free of lettering');
    expect(prompt).not.toContain('Reserve an intentional');
  });

  it('gives changed medium and composition mode distinct generation identities', () => {
    const input = generateThumbnailInput.parse({
      projectId: newId<'Project'>(),
      prompt: 'Airport cover',
      hookText: 'Never gets old',
    });
    const base = generateThumbnailKey(input);
    expect(generateThumbnailKey({ ...input, medium: 'illustration' })).not.toBe(base);
    expect(generateThumbnailKey({ ...input, composition: 'complete' })).not.toBe(base);
    expect(generateThumbnailKey({ ...input, composition: 'backdrop' })).toBe(base);
  });
});
