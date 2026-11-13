// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { AssetId, CardOf } from '@taalcut/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CARD_FIXTURES,
  CardActionsProvider,
  CardDataProvider,
  CardView,
  type CardActions,
  type CardData,
} from '../../src/index';

const cover = { fileName: 'Airport cover.jpg', width: 1080, height: 1920, revision: 41 };
const coverAssetId = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6' as AssetId;
const receipt = (asset = false): CardOf<'toolRun'> => ({
  ...CARD_FIXTURES.toolRun.succeeded!,
  tool: 'render.exportCover',
  savedCover: { ...cover, ...(asset ? { assetId: coverAssetId } : {}) },
});
const show = (card = receipt(), actions: CardActions = {}, data: CardData = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardDataProvider value={data}>
        <CardActionsProvider value={actions}>
          <CardView card={card} />
        </CardActionsProvider>
      </CardDataProvider>
    </I18nProvider>,
  );

describe('saved cover result', () => {
  it('keeps the committed JPEG usable without a preview or another generation request', async () => {
    const saveExportAs = vi.fn(async () => ({ ok: true as const, value: null }));
    show(receipt(), { saveExportAs });
    expect(screen.getByText('Airport cover.jpg')).toBeTruthy();
    expect(screen.getByText('JPEG · 1,080 × 1,920')).toBeTruthy();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save JPEG' })));
    expect(saveExportAs).toHaveBeenCalledExactlyOnceWith('Airport cover.jpg');
  });

  it('shows the actual indexed asset and unsubscribes on unmount', async () => {
    let update: ((url: string | null) => void) | undefined;
    const stop = vi.fn();
    const card = receipt(true);
    const watchAssetImage = vi.fn((_id, receive) => {
      update = receive;
      return stop;
    });
    const { unmount } = show(card, {}, { watchAssetImage });
    expect(watchAssetImage).toHaveBeenCalledWith(card.savedCover!.assetId, expect.any(Function));
    await act(async () => update?.('app://preview/cover.jpg'));
    expect(screen.getByRole('img', { name: 'Exported cover' }).getAttribute('src')).toBe(
      'app://preview/cover.jpg',
    );
    expect(screen.queryByRole('button', { name: 'Save JPEG' })).toBeNull();
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('prevents duplicate saves while the native dialog is open and permits retry after failure', async () => {
    let finish!: (value: Awaited<ReturnType<NonNullable<CardActions['saveExportAs']>>>) => void;
    const saveExportAs = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<NonNullable<CardActions['saveExportAs']>>>>((resolve) => {
          finish = resolve;
        }),
    );
    show(receipt(), { saveExportAs });
    const button = screen.getByRole('button', { name: 'Save JPEG' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(saveExportAs).toHaveBeenCalledOnce();
    expect(button.getAttribute('aria-busy')).toBe('true');
    await act(async () =>
      finish({
        ok: false,
        error: { code: 'files.save_failed', messageKey: 'errors.generic', retryable: true },
      }),
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(button.getAttribute('aria-busy')).toBeNull();
    fireEvent.click(button);
    expect(saveExportAs).toHaveBeenCalledTimes(2);
    await act(async () => finish({ ok: true, value: null }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
