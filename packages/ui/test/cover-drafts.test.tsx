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

it('shows a cover saved elsewhere in place of a draft nobody touched, and keeps one the person changed', () => {
  const fallback: CoverSettings = {
    archetype: 'atmospheric-cinema',
    theme: 'golden-hour',
    textAlign: 'bottom-left',
    kickerText: '',
    statBadge: '',
    aspect: '9:16',
    source: { kind: 'frame', frame: 0 },
    hookText: '',
  };
  const made = { ...fallback, hookText: 'Made by Taalcut' };
  const wide = { ...fallback, aspect: '16:9' as const, hookText: 'Wide' };
  const hook = renderHook(
    ({ timeline }) => useCoverDrafts(timeline, fallback, (aspect) => ({ ...fallback, aspect })),
    { initialProps: { timeline: {} as Timeline } },
  );
  // CVR1: no cover saved yet and nothing changed here: the cover the AI saves shows at once, with no conflict.
  expect(hook.result.current.dirty).toBe(true);
  hook.rerender({ timeline: { covers: [made] } as Timeline });
  expect(hook.result.current).toMatchObject({ cover: made, conflict: false, dirty: false });
  // A draft the person changed is theirs: a cover saved meanwhile is offered, never swapped in.
  act(() => hook.result.current.select('16:9'));
  act(() => hook.result.current.patch({ hookText: 'Mine' }));
  hook.rerender({ timeline: { covers: [made, wide] } as Timeline });
  expect(hook.result.current).toMatchObject({ conflict: true, cover: { hookText: 'Mine' } });
});
