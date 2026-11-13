// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportThumbnail } from '../src/features/library/imports/import-thumbnail';

afterEach(() => vi.useRealTimers());
describe('native import preview arrivals', () => {
  it('retries transient local misses three times, then stops', async () => {
    vi.useFakeTimers();
    const { container } = render(
      <ImportThumbnail url="app://media/device/AAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBB.jpg" />,
    );
    for (const [index, delay] of [250, 500, 1000].entries()) {
      fireEvent.error(container.querySelector('img')!);
      await act(() => vi.advanceTimersByTimeAsync(delay));
      expect(container.querySelector('img')!.src).toContain(`previewAttempt=${index + 1}`);
    }
    fireEvent.error(container.querySelector('img')!);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(container.querySelector('img')!.src).toContain('previewAttempt=3');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels pending requests when a virtualized row unmounts', () => {
    vi.useFakeTimers();
    const { container, unmount } = render(
      <ImportThumbnail url="app://media/device/AAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBB.jpg" />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
