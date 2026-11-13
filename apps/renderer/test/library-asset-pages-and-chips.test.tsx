// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { I18nProvider } from '@lingui/react';
import type * as Router from '@tanstack/react-router';
import { TooltipProvider } from '@taalcut/ui';
import {
  MAX_SELECTIONS,
  NotFoundError,
  newId,
  toRpcError,
  type AssetDetail,
  type AssetId,
  type AssetSummary,
  type EventOf,
  type SelectionChip,
} from '@taalcut/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { COMPOSER_DRAFT_KEY } from '../src/chat/handoff';
import {
  addSelection,
  resetSelectionsForTests,
  selectionKey,
  takeSelections,
} from '../src/chat/selection-store';
import { useChipViews } from '../src/chat/selection-views';
import { SentChips } from '../src/chat/sent-chips';
import { BulkBar } from '../src/features/library/bulk-bar';
import { ClipActions } from '../src/features/library/clip/clip-actions';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';
import { useAssetPages, type AssetPages } from '../src/features/library/use-asset-pages';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { createTestServices } from '../src/services/create';
import { ServicesProvider } from '../src/services/provider';
import { watched } from './settings/spied-backend';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  useNavigate: () => navigateMock,
}));

beforeAll(() => activateLocale('en'));

afterEach(() => {
  navigateMock.mockReset();
  resetSelectionsForTests();
  sessionStorage.removeItem(COMPOSER_DRAFT_KEY);
});

function makeAssetSummary(index: number, id: AssetId = newId<'Asset'>()): AssetSummary {
  return {
    ...CLIP_FIXTURE.asset,
    id,
    name: `IMG_${String(index).padStart(4, '0')}.MOV`,
  };
}

function ChildGridEnsure({ ensure }: { ensure: (count: number) => void }) {
  useEffect(() => {
    ensure(24);
  }, [ensure]);
  return null;
}

function AssetPagesHarness({ onPages }: { onPages: (pages: AssetPages) => void }) {
  const pages = useAssetPages({}, 'captured', 'desc');
  onPages(pages);
  return <ChildGridEnsure ensure={pages.ensure} />;
}

describe('useAssetPages child ensure() mount race & deduplication', () => {
  it('fetches once and keeps 76 items (never 152) when child useEffect calls ensure() on mount', async () => {
    const items76 = Array.from({ length: 76 }, (_, index) => makeAssetSummary(index + 1));
    const fake = createFakeBackend();
    const calls = new Map<string, unknown[]>();
    const browse = vi.fn(async () => ({ items: items76, total: 76, nextCursor: undefined }));
    const backend = watched(
      fake.client,
      [{ namespace: 'library', procedure: 'browse', answer: () => browse() }],
      calls,
    );

    let latest: AssetPages | undefined;
    render(
      <BackendProvider backend={backend}>
        <AssetPagesHarness onPages={(pages) => (latest = pages)} />
      </BackendProvider>,
    );

    await waitFor(() => expect(latest?.total).toBe(76));
    expect(browse).toHaveBeenCalledTimes(1);
    expect(latest?.items).toHaveLength(76);
    expect(new Set(latest?.items.map((item) => item.id)).size).toBe(76);
  });

  it('deduplicates AssetIds across paginated responses', async () => {
    const first = makeAssetSummary(1);
    const second = makeAssetSummary(2);
    const third = makeAssetSummary(3);
    const fake = createFakeBackend();
    const calls = new Map<string, unknown[]>();
    const browse = vi
      .fn()
      .mockResolvedValueOnce({ items: [first, second], total: 3, nextCursor: 'page-2' })
      .mockResolvedValueOnce({ items: [second, third], total: 3, nextCursor: undefined });
    const backend = watched(
      fake.client,
      [{ namespace: 'library', procedure: 'browse', answer: () => browse() }],
      calls,
    );

    let latest: AssetPages | undefined;
    function MultiPageHarness() {
      const pages = useAssetPages({}, 'captured', 'desc');
      latest = pages;
      useEffect(() => {
        pages.ensure(3);
      }, [pages.ensure]);
      return null;
    }

    render(
      <BackendProvider backend={backend}>
        <MultiPageHarness />
      </BackendProvider>,
    );

    await waitFor(() => expect(latest?.items).toHaveLength(3));
    expect(latest?.items.map((item) => item.id)).toEqual([first.id, second.id, third.id]);
  });
});

describe('library asset selection chips end-to-end', () => {
  it('keys asset chips by assetId and accepts up to MAX_SELECTIONS (50)', () => {
    const firstId = newId<'Asset'>();
    expect(selectionKey({ kind: 'asset', assetId: firstId, name: 'A.MOV' })).toBe(`asset:${firstId}`);
    expect(addSelection({ kind: 'asset', assetId: firstId, name: 'A.MOV' })).toBe('added');
    expect(addSelection({ kind: 'asset', assetId: firstId, name: 'A.MOV' })).toBe('already');

    for (let index = 2; index <= MAX_SELECTIONS; index += 1) {
      expect(addSelection({ kind: 'asset', assetId: newId<'Asset'>(), name: `${index}.MOV` })).toBe('added');
    }
    expect(MAX_SELECTIONS).toBe(50);
    expect(addSelection({ kind: 'asset', assetId: newId<'Asset'>(), name: 'overflow.MOV' })).toBe('full');
    expect(takeSelections()).toHaveLength(50);
  });

  it('BulkBar deduplicates picked clips, clears stale chips, and attaches 12 asset chips on Make a video', () => {
    const fake = createFakeBackend();
    const services = createTestServices();
    const clips12 = Array.from({ length: 12 }, (_, index) => makeAssetSummary(index + 1));
    // Simulate a duplicated items list (24 entries for 12 ids) as defense-in-depth.
    const duplicatedItems = [...clips12, ...clips12];
    const pickedIds = new Set<AssetId>(clips12.map((clip) => clip.id));

    // Seed a stale selection that must be cleared before starting the new chat.
    addSelection({ kind: 'effect', effectId: 'kineticTitle' });

    render(
      <I18nProvider i18n={i18n}>
        <BackendProvider backend={fake.client}>
          <ServicesProvider services={services}>
            <BulkBar ids={pickedIds} items={duplicatedItems} onDone={vi.fn()} />
          </ServicesProvider>
        </BackendProvider>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Make a video with these' }));

    const draft = sessionStorage.getItem(COMPOSER_DRAFT_KEY) ?? '';
    for (const clip of clips12) {
      expect(draft.split(clip.name)).toHaveLength(2);
    }

    const chips = takeSelections();
    expect(chips).toEqual(
      clips12.map((clip) => ({
        kind: 'asset',
        assetId: clip.id,
        name: clip.name,
      })),
    );
    expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({ to: '/chat/$conversationId' }));
  });

  it('ClipActions clears stale chips and attaches the clip as an asset chip on Make a video', () => {
    const fake = createFakeBackend();
    const services = createTestServices();
    addSelection({ kind: 'effect', effectId: 'kineticTitle' });

    render(
      <I18nProvider i18n={i18n}>
        <TooltipProvider>
          <BackendProvider backend={fake.client}>
            <ServicesProvider services={services}>
              <ClipActions detail={CLIP_FIXTURE} />
            </ServicesProvider>
          </BackendProvider>
        </TooltipProvider>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Make a video with this clip' }));
    expect(takeSelections()).toEqual([
      {
        kind: 'asset',
        assetId: CLIP_FIXTURE.asset.id,
        name: CLIP_FIXTURE.asset.name,
      },
    ]);
    expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({ to: '/chat/$conversationId' }));
  });

  it('resolves asset chips with zero-flicker fallback, refreshes on library.changed, and opens in SentChips', async () => {
    const assetId = CLIP_FIXTURE.asset.id;
    let currentDetail: AssetDetail | null = {
      ...CLIP_FIXTURE,
      asset: { ...CLIP_FIXTURE.asset, name: 'Renamed_Clip.MOV', trashed: false },
    };
    let resolveAssetGate!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      resolveAssetGate = resolve;
    });
    let firstCall = true;
    type ChangedEvent = EventOf<'library.changed'>;
    const listeners = new Set<(event: ChangedEvent) => void>();

    const fake = createFakeBackend();
    const calls = new Map<string, unknown[]>();
    const backend = watched(
      fake.client,
      [
        {
          namespace: 'library',
          procedure: 'asset',
          answer: async () => {
            if (firstCall) {
              firstCall = false;
              await firstGate;
            }
            if (!currentDetail) throw toRpcError(NotFoundError({ entity: 'asset', id: assetId }));
            return currentDetail;
          },
        },
        {
          namespace: 'events',
          procedure: 'subscribe',
          answer: async () => {
            const queue: ChangedEvent[] = [];
            let wake: (() => void) | null = null;
            const push = (event: ChangedEvent) => {
              queue.push(event);
              wake?.();
              wake = null;
            };
            listeners.add(push);
            async function* stream() {
              try {
                for (;;) {
                  while (queue.length > 0) yield queue.shift()!;
                  await new Promise<void>((resolve) => {
                    wake = resolve;
                  });
                }
              } finally {
                listeners.delete(push);
              }
            }
            return stream();
          },
        },
      ],
      calls,
    );

    const chips: SelectionChip[] = [{ kind: 'asset', assetId, name: 'Initial_Name.MOV' }];
    const snapshots: ReturnType<typeof useChipViews>[] = [];

    function Probe() {
      const views = useChipViews(chips);
      snapshots.push(views);
      return <SentChips chips={chips} />;
    }

    const view = render(
      <I18nProvider i18n={i18n}>
        <BackendProvider backend={backend}>
          <Probe />
        </BackendProvider>
      </I18nProvider>,
    );

    // Synchronous initial render uses chip.name immediately with zero flicker!
    expect(snapshots[0]?.[0]?.view).toEqual({
      kind: 'asset',
      key: `asset:${assetId}`,
      name: 'Initial_Name.MOV',
    });
    expect(screen.getByText('Initial_Name.MOV')).toBeTruthy();

    await act(async () => {
      resolveAssetGate();
    });
    await waitFor(() => expect(screen.getByText('Renamed_Clip.MOV')).toBeTruthy());

    // Clicking an asset chip in SentChips navigates to /library/$assetId.
    fireEvent.click(screen.getByRole('button', { name: 'Renamed_Clip.MOV' }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/library/$assetId',
      params: { assetId },
    });

    // Deleting the asset invalidates the cache on library.changed and marks it gone while keeping its name.
    currentDetail = null;
    await act(async () => {
      for (const listener of listeners) {
        listener({
          type: 'library.changed',
          at: Date.now(),
          payload: { projectId: null, entity: 'asset', change: 'deleted', ids: [assetId] },
        });
      }
    });
    await waitFor(() => expect(screen.getByText('This was deleted.')).toBeTruthy());
    expect(screen.getByText('Initial_Name.MOV')).toBeTruthy();

    view.unmount();
  });
});
