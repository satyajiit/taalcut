// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, render, screen } from '@testing-library/react';
import type * as Motion from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThoughtLine } from '../src/chat/thought-line';

const motion = vi.hoisted(() => ({
  reduce: false,
  animate: vi.fn((_element: unknown, _frames: unknown, _options: { repeat?: number }) =>
    Object.assign(Promise.resolve(), { stop: vi.fn() }),
  ),
}));

vi.mock('motion/react', async (original) => ({
  ...(await original<typeof Motion>()),
  useReducedMotion: () => motion.reduce,
  animate: motion.animate,
}));

beforeEach(() => {
  motion.reduce = false;
  motion.animate.mockClear();
});
afterEach(() => vi.restoreAllMocks());

async function show(glyph?: 'none') {
  const view = render(
    <I18nProvider i18n={i18n}>
      <ThoughtLine working showTimer={false} collapsible={false} {...(glyph ? { glyph } : {})} />
    </I18nProvider>,
  );
  await act(async () => Promise.resolve());
  return view;
}

const loops = () =>
  motion.animate.mock.calls.flatMap(([, , options], index) =>
    options.repeat === Infinity ? [motion.animate.mock.results[index]!.value as { stop: () => void }] : [],
  );

describe('ThoughtLine motion', () => {
  it('uses a solid breathing indicator without a sparkle or shimmer', async () => {
    const { container } = await show();
    expect(loops().length).toBeGreaterThan(0);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-shimmer]')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Thinking…');
  });

  it('stops breathing while hidden without reporting that work finished, and resumes when visible', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { container } = await show();
    const active = loops();
    motion.animate.mockClear();
    await act(async () => {
      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    for (const animation of active) expect(animation.stop).toHaveBeenCalled();
    expect(loops()).toHaveLength(0);
    expect(container.querySelector('[data-working]')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Thinking…');
    await act(async () => {
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(loops().length).toBeGreaterThan(0);
  });

  it('keeps reduced-motion work still and honors an explicitly omitted glyph', async () => {
    motion.reduce = true;
    const { container } = await show('none');
    expect(loops()).toHaveLength(0);
    expect(container.querySelector('[data-working]')).not.toBeNull();
    expect(container.querySelector('[data-shimmer]')).toBeNull();
    expect(container.querySelector('.rounded-full')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Thinking…');
  });
});
