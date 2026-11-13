// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { registerBones, Skeleton } from '../src/index';

const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

afterEach(() => {
  delete (window as { __BONEYARD_BUILD?: boolean }).__BONEYARD_BUILD;
});

describe('Skeleton', () => {
  it('shows shimmering lines and marks the region busy while loading without captured bones', () => {
    const { container } = wrap(
      <Skeleton name="test-uncaptured" loading>
        <p>Loaded</p>
      </Skeleton>,
    );
    const region = container.querySelector('[data-boneyard="test-uncaptured"]');
    expect(region?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status')?.textContent).toContain('Loading');
    expect(container.querySelectorAll('.tc-bone').length).toBeGreaterThan(0);
    expect(screen.queryByText('Loaded')).toBeNull();
  });

  it('shows the content once loaded', () => {
    const { container } = wrap(
      <Skeleton name="test-loaded" loading={false}>
        <p>Loaded</p>
      </Skeleton>,
    );
    expect(screen.getByText('Loaded')).toBeTruthy();
    expect(container.querySelector('[aria-busy]')).toBeNull();
  });

  it('draws captured bones as solid token-coloured blocks with our pulse class, no inline <style>', () => {
    registerBones({
      'test-captured': {
        name: 'test-captured',
        viewportWidth: 1280,
        width: 400,
        height: 60,
        bones: [
          { x: 0, y: 0, w: 50, h: 16, r: 4 },
          { x: 0, y: 24, w: 90, h: 16, r: 4 },
        ],
      },
    });
    const { container } = wrap(
      <Skeleton name="test-captured" loading>
        <p>Loaded</p>
      </Skeleton>,
    );
    const bones = container.querySelectorAll<HTMLElement>('[data-boneyard-bone]');
    expect(bones).toHaveLength(2);
    expect(bones[0]?.className).toBe('tc-bone');
    expect(bones[0]?.style.backgroundColor).toBe('var(--color-hover)');
    expect(container.querySelector('style')).toBeNull();
  });

  it('renders the fixture in the capture browser', () => {
    (window as { __BONEYARD_BUILD?: boolean }).__BONEYARD_BUILD = true;
    wrap(
      <Skeleton name="test-fixture" loading fixture={<p>Stand-in</p>}>
        <p>Loaded</p>
      </Skeleton>,
    );
    expect(screen.getByText('Stand-in')).toBeTruthy();
  });
});
