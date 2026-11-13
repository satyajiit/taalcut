// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { AssetId, CardOf, RunId, ToolRunId } from '@taalcut/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_FIXTURES,
  CardActionsProvider,
  CardDataProvider,
  CardView,
  ToolRunRow,
  toolLabel,
  type CardActions,
  type CardData,
} from '../src/index';

const wrap = (node: ReactNode, actions: CardActions = {}, data: CardData = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardDataProvider value={data}>
        <CardActionsProvider value={actions}>{node}</CardActionsProvider>
      </CardDataProvider>
    </I18nProvider>,
  );

const fixture = (): CardOf<'publishPack'> => CARD_FIXTURES.publishPack.complete!;

describe('PublishPackCard', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('renders the thumbnail studio, channel badge, and research insights', () => {
    wrap(<CardView card={fixture()} />, {}, { artifactUrl: (id) => `app://artifact/${id}` });

    expect(screen.getByRole('heading', { name: 'Thumbnail & publish pack' })).toBeTruthy();
    expect(screen.getByText('Ready to review')).toBeTruthy();
    expect(screen.queryByText('Publish ready')).toBeNull();
    expect(screen.getByText('2 formats · 3 takes · $0.12 so far')).toBeTruthy();
    expect(screen.queryByText('Hallmark verified')).toBeNull();
    expect(screen.getByText('5 AM AT THE FLOWER MARKET')).toBeTruthy();
    expect(screen.getByText('OLD DELHI · 12 STALLS')).toBeTruthy();
    expect(screen.getByText('48S CUT')).toBeTruthy();
    expect(screen.getByText('Video research insights')).toBeTruthy();
  });

  it('shows grounded publishing copy without requiring a thumbnail or implying publication', () => {
    const { container } = wrap(
      <CardView card={{ ...fixture(), thumbnails: [], spent: { currency: 'USD', micros: 0 } }} />,
    );
    expect(screen.getByRole('heading', { name: 'Publishing copy' })).toBeTruthy();
    expect(screen.getByText('Ready to review')).toBeTruthy();
    expect(screen.queryByText('Publish ready')).toBeNull();
    expect(container.querySelector('[data-slot="thumbnail-canvas"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy YouTube title' })).toBeTruthy();
  });

  it('displays the finished cover without adding thumbnail typography or claiming a design evaluation', async () => {
    const coverAssetId = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6' as AssetId;
    const shot = vi.fn(async () => ({
      url: 'app://exact-cover.jpg',
      name: 'Cover',
      description: null,
      duration: null,
    }));
    const { container } = wrap(
      <CardView card={{ ...fixture(), thumbnails: [], coverAssetId }} />,
      {},
      { shot },
    );
    expect(
      (await screen.findByRole('img', { name: 'Cover exported from this short' })).getAttribute('src'),
    ).toBe('app://exact-cover.jpg');
    expect(shot).toHaveBeenCalledWith(coverAssetId, null);
    expect(container.querySelector('[data-slot="thumbnail-canvas"]')).toBeNull();
  });

  it('updates a saved cover when image indexing finishes after the card opens', async () => {
    const coverAssetId = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6' as AssetId;
    let update: ((url: string | null) => void) | undefined;
    const stop = vi.fn();
    const { unmount } = wrap(
      <CardView card={{ ...fixture(), thumbnails: [], coverAssetId }} />,
      {},
      {
        watchAssetImage: (_id, changed) => {
          update = changed;
          changed(null);
          return stop;
        },
      },
    );
    expect(screen.queryByRole('img', { name: 'Cover exported from this short' })).toBeNull();
    await act(async () => {
      update?.('app://indexed-cover.jpg');
    });
    expect(screen.getByRole('img', { name: 'Cover exported from this short' }).getAttribute('src')).toBe(
      'app://indexed-cover.jpg',
    );
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('switches aspect ratios and updates the active variant and safe-zone overlays', () => {
    const { container } = wrap(<CardView card={fixture()} />);

    const canvas = () => container.querySelector<HTMLElement>('[data-slot="thumbnail-canvas"]')!;
    expect(canvas().dataset.aspect).toBe('16:9');

    // Toggle safe zones on 16:9 -> shows duration zone
    fireEvent.click(screen.getByRole('button', { name: 'Safe zones' }));
    expect(container.querySelector('[data-slot="safe-zones-overlay"]')?.textContent).toContain('0:48');

    // Switch to 9:16 Shorts & Reels -> shows 9:16 variant hook & IG 4:5 profile grid crop guide
    fireEvent.click(screen.getByRole('button', { name: '9:16 Shorts & Reels' }));
    expect(canvas().dataset.aspect).toBe('9:16');
    expect(screen.getByText('BEFORE THE CITY WAKES UP')).toBeTruthy();
    expect(container.querySelector('[data-slot="ig-grid-crop-guide"]')?.textContent).toContain(
      '4:5 & 1:1 profile grid crop',
    );

    // Switch to 4:5 IG Feed and 1:1 IG Grid
    fireEvent.click(screen.getByRole('button', { name: '4:5 IG Feed' }));
    expect(canvas().dataset.aspect).toBe('4:5');
    fireEvent.click(screen.getByRole('button', { name: '1:1 IG Grid' }));
    expect(canvas().dataset.aspect).toBe('1:1');
  });

  it('switches Hallmark archetypes and themes live on the card', () => {
    const { container } = wrap(<CardView card={fixture()} />);
    const canvas = () => container.querySelector<HTMLElement>('[data-slot="thumbnail-canvas"]')!;

    expect(canvas().dataset.archetype).toBe('editorial-specimen');
    expect(canvas().dataset.theme).toBe('golden-hour');

    fireEvent.click(screen.getByRole('button', { name: 'Brutal' }));
    expect(canvas().dataset.archetype).toBe('brutal-slab');

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    expect(canvas().dataset.theme).toBe('terminal');
  });

  it('toggles channel branding badge and updates channel name/handle live in Canvas and Feed preview', () => {
    const { container } = wrap(<CardView card={fixture()} />);

    expect(container.querySelector('[data-slot="thumbnail-channel-badge"]')?.textContent).toContain(
      'Mira Shah',
    );

    // Edit channel name and handle
    fireEvent.change(screen.getByRole('textbox', { name: 'Channel name' }), {
      target: { value: 'Asha Films' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Channel handle' }), {
      target: { value: 'ashafilms' },
    });
    expect(container.querySelector('[data-slot="thumbnail-channel-badge"]')?.textContent).toContain(
      'Asha Films',
    );
    expect(container.querySelector('[data-slot="thumbnail-channel-badge"]')?.textContent).toContain(
      '@ashafilms',
    );

    // Toggle channel badge off
    fireEvent.click(screen.getByRole('button', { name: 'Channel badge' }));
    expect(container.querySelector('[data-slot="thumbnail-channel-badge"]')).toBeNull();

    // Switch to Feed preview mode and verify YouTube Home feed card
    fireEvent.click(screen.getByRole('button', { name: 'Feed preview' }));
    const feed = container.querySelector<HTMLElement>('[data-slot="feed-preview"]')!;
    expect(feed.dataset.feedType).toBe('youtube');
    expect(feed.textContent).toContain('Asha Films');
    expect(feed.textContent).toContain('@ashafilms');
    expect(feed.textContent).toContain('5 AM at the Old Delhi Flower Market — Before the City Wakes Up');
  });

  it('switches takes and dispatches follow-up for making another take', async () => {
    const followUp = vi.fn(async () => ({ ok: true as const, value: undefined }));
    wrap(<CardView card={fixture()} />, { followUp });

    const take2 = screen.getByRole('button', { name: 'Take 2' });
    expect(take2.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(take2);
    expect(take2.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Make another take' }));
    await waitFor(() => expect(followUp).toHaveBeenCalledTimes(1));
  });

  it('swaps YouTube alternate titles and copies multi-selected social blocks to clipboard', async () => {
    const { container } = wrap(<CardView card={fixture()} />);

    // Click an alternate YouTube title chip
    const altTitle = 'Inside the 5 AM Marigold Market (48 Seconds in Old Delhi)';
    fireEvent.click(screen.getByRole('button', { name: altTitle }));
    expect(container.querySelector('[data-slot="active-yt-title"]')?.textContent).toBe(altTitle);

    // Copy just the YouTube title block
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy YouTube title' }));
    });
    expect(writeText).toHaveBeenCalledWith(altTitle);

    // Default has all 5 sections checked -> "Copy selected (5)"
    expect(screen.getByRole('button', { name: 'Copy selected (5)' })).toBeTruthy();

    // Uncheck TikTok and Instagram so 3 remain selected
    fireEvent.click(screen.getByRole('checkbox', { name: 'TikTok caption & SEO keywords' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Instagram Reels caption' }));
    expect(screen.getByRole('button', { name: 'Copy selected (3)' })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy selected (3)' }));
    });
    const copied = writeText.mock.calls.at(-1)?.[0] ?? '';
    expect(copied).toContain('=== YOUTUBE TITLE ===');
    expect(copied).toContain(altTitle);
    expect(copied).toContain('=== YOUTUBE DESCRIPTION & CHAPTERS ===');
    expect(copied).toContain('00:00 First chai at the gate');
    expect(copied).toContain('=== YOUTUBE TAGS ===');
    expect(copied).toContain('old delhi, flower market');
    expect(copied).not.toContain('=== TIKTOK ===');

    // Clear all -> Select all toggle
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Copy selected (5)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((screen.getByRole('button', { name: 'Copy selected (0)' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('registers images.generateThumbnail label and shows ImageGeneration animation in ToolRunRow', () => {
    expect(toolLabel(i18n, 'images.generateThumbnail')).toBe('Generate video thumbnail');
    const { container } = wrap(
      <ToolRunRow
        card={{
          type: 'toolRun',
          id: 'tr-thumb',
          version: 1,
          runId: '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as RunId,
          toolRunId: '01K7C5M6Q8R9S0T1V2W3X4Y5Z8' as ToolRunId,
          tool: 'images.generateThumbnail',
          status: 'running',
          startedAt: 1_000,
          summary: '16:9 YouTube cover',
        }}
      />,
    );
    expect(container.querySelector('[data-slot="image-generation"]')).not.toBeNull();
  });
});
