// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, renderHook } from '@testing-library/react';
import type { CoverSettings, Timeline } from '@taalcut/core';
import { expect, it } from 'vitest';
import { useCoverDrafts } from '../src/cards/use-cover-drafts';

it('retains separate drafts on aspect changes, repeated selection, and conflicting remote writes', () => {
  const vertical: CoverSettings = {
    archetype: 'minimal-frame',
    theme: 'golden-hour',
    textAlign: 'left',
    kickerText: '',
    statBadge: '',
    aspect: '9:16',
    source: { kind: 'frame', frame: 2 },
    hookText: 'Saved',
  };
  const square = { ...vertical, aspect: '1:1' as const, hookText: 'Square' };
  const initial = { covers: [square, vertical] } as Timeline;
  const hook = renderHook(
    ({ timeline }) => useCoverDrafts(timeline, vertical, (aspect) => ({ ...vertical, aspect })),
    { initialProps: { timeline: initial } },
  );
  act(() => hook.result.current.patch({ hookText: 'My draft' }));
  act(() => hook.result.current.select('9:16'));
  expect(hook.result.current.cover.hookText).toBe('My draft');
  act(() => hook.result.current.select('1:1'));
  act(() => hook.result.current.patch({ hookText: 'Square draft' }));
  act(() => hook.result.current.select('9:16'));
  expect(hook.result.current.cover.hookText).toBe('My draft');
  hook.rerender({ timeline: { ...initial, covers: [square, { ...vertical, hookText: 'Other window' }] } });
  expect(hook.result.current.conflict).toBe(true);
  expect(hook.result.current.cover.hookText).toBe('My draft');
  act(() => hook.result.current.discard());
  expect(hook.result.current.cover.hookText).toBe('Other window');
  act(() => hook.result.current.select('1:1'));
  expect(hook.result.current.cover.hookText).toBe('Square draft');
});
