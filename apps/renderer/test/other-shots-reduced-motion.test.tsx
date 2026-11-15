// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { REST_MS } from '../src/features/timeline/other-shots/use-other-shots';
import { SceneStrip } from '../src/features/timeline/scene-strip';
import { filmstripFixture, LoadedImage, pointer, ShotsHarness } from './other-shots-support';
import { mountEditorControl } from './simple-editor-support';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Image', LoadedImage);
  // This file's person asked the Mac for less motion (setup.ts answers "no" to every media query).
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query.includes('prefers-reduced-motion'),
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

it('under reduced motion a shot stays on the frame it would start from: nothing plays on its own', async () => {
  const f = filmstripFixture();
  mountEditorControl(
    <ShotsHarness timeline={f.timeline} edits={f.edits} lookup={f.lookup}>
      {(model) => (
        <SceneStrip
          model={model}
          selectedIds={[]}
          onPick={vi.fn()}
          pictureFor={() => null}
          onEdit={vi.fn()}
        />
      )}
    </ShotsHarness>,
  );
  pointer(document.querySelector('[data-scene-clip] button')!, 'pointermove');
  await wait(REST_MS);
  const option = within(screen.getByRole('dialog')).getAllByRole('option')[1]!;
  const frame = () => option.querySelector('[data-frame]');
  expect(frame()?.getAttribute('data-frame')).toBe('4');
  pointer(option, 'pointerover');
  await wait(3000);
  expect(frame()?.getAttribute('data-frame')).toBe('4');
  expect(frame()?.hasAttribute('data-playing')).toBe(false);
});
