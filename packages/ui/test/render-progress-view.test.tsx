// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// RenderProgressView's word for a finished render (UX4, from the agt lane): "Exported" by default, and the caller's
// own word for what isn't an export (a QA draft, a preview), so a draft never says it was exported.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { RenderProgressView, type RenderView } from '../src/index';

const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const READY: RenderView = {
  status: 'ready',
  progress: { fraction: 1 },
  presetId: 'reels',
  name: 'Golden hour market – Instagram Reels',
  durationFrames: 450,
  rate: { num: 30, den: 1 },
  bytes: 15_000_000,
  notify: false,
  qa: null,
  error: null,
};

describe('a finished render', () => {
  it('says Exported unless the caller names it', () => {
    wrap(<RenderProgressView render={READY} />);
    expect(screen.getByRole('status').textContent).toContain('Exported');
  });

  it('says the caller’s word for what isn’t an export, and never Exported', () => {
    wrap(<RenderProgressView render={READY} finishedLabel="Draft ready" />);
    const line = screen.getByRole('status');
    expect(line.textContent).toContain('Draft ready');
    expect(line.textContent).not.toContain('Exported');
  });
});
