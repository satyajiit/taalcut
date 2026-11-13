// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The export dialog's preset list (UX1, M14): a limit reads as people say it, never "2.983 min". */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PresetPicker, type PresetOption } from '../src/index';

const OPTIONS: readonly PresetOption[] = [
  { id: 'shorts', available: true, maxSeconds: 179, estimateBytes: 15_000_000 },
  { id: 'reels', available: true, maxSeconds: 150 },
  { id: 'tiktok', available: true, maxSeconds: 90 },
  { id: 'device', available: true, maxSeconds: 600 },
];

describe('PresetPicker limits', () => {
  it('rounds a limit to a tenth of a minute, and keeps seconds under two minutes', () => {
    render(
      <I18nProvider i18n={i18n}>
        <PresetPicker options={OPTIONS} value="shorts" onChange={vi.fn()} variant="list" />
      </I18nProvider>,
    );
    const text = (name: RegExp) => screen.getByRole('radio', { name }).textContent ?? '';
    expect(text(/YouTube Shorts/)).toContain('Up to 3 min');
    expect(text(/YouTube Shorts/)).not.toContain('2.983');
    expect(text(/Instagram Reels/)).toContain('Up to 2.5 min');
    expect(text(/TikTok/)).toContain('Up to 90 sec');
    expect(text(/Save to this Mac/)).toContain('Up to 10 min');
  });
});
