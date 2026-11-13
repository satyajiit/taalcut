// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { HostPlatformProvider } from '@taalcut/ui';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildReelIdeaPrompt,
  buildReelIdeaSearch,
  getReelIdeas,
  pairedTrackForIdea,
} from '../src/features/insights/reel-ideas-data';
import { ReelIdeasSection } from '../src/features/insights/reel-ideas-section';
import { parseEditsTracks } from '../src/features/make/edits-pulse-model';

beforeEach(() => i18n.loadAndActivate({ locale: 'en', messages: {} }));

const tracks = () =>
  parseEditsTracks(
    {
      tracks: [
        { id: 'unrelated-row', audioAssetId: 'unrelated-asset', title: 'An unrelated real track' },
        {
          id: 'matched-row',
          audioAssetId: 'matched-asset',
          title: 'A matched real track',
          durationSeconds: 22,
        },
      ],
    },
    new Set(),
  );

describe('reel idea inspiration', () => {
  it('offers editable creative ideas without preset audio identifiers or claims about trends, rights or retention', () => {
    const ideas = getReelIdeas(i18n);
    expect(ideas).toHaveLength(6);
    for (const idea of ideas) {
      expect(idea.pairedTrackId).toBeUndefined();
      const search = buildReelIdeaSearch(idea);
      expect(search).not.toHaveProperty('audioAssetId');
      expect(search.prompt).toBe(idea.prompt);
      expect(JSON.stringify(idea)).not.toMatch(
        /audioAssetId|trending|high-retention|licensed|royalty-free|\d{12}/i,
      );
      expect(idea.scenes[0]!.startSeconds).toBe(0);
      expect(idea.scenes.at(-1)!.endSeconds).toBe(idea.durationSeconds);
    }
  });

  it('pairs only an exact supplied feed identifier, using the actual asset consistently in both handoffs', () => {
    const idea = getReelIdeas(i18n)[0]!;
    expect(pairedTrackForIdea(idea, tracks())).toBeUndefined();
    expect(pairedTrackForIdea({ ...idea, pairedTrackId: 'missing' }, tracks())).toBeUndefined();
    const paired = pairedTrackForIdea({ ...idea, pairedTrackId: 'matched-asset' }, tracks());
    expect(paired!.id).toBe('matched-row');
    expect(pairedTrackForIdea({ ...idea, pairedTrackId: 'matched-row' }, tracks())).toEqual(paired);
    const search = buildReelIdeaSearch(idea, paired);
    expect(search.audioAssetId).toBe('matched-asset');
    expect(search.prompt).toBe(buildReelIdeaPrompt(idea, paired));
    expect(search.prompt.match(/audioAssetId:/g)).toHaveLength(1);
    expect(search.prompt).not.toContain('unrelated-asset');
  });

  it('keeps an unrelated feed track out of the rendered idea and Create/chat actions', async () => {
    const onCutIdeaWithAgent = vi.fn();
    const root = createRootRoute({
      component: () => (
        <ReelIdeasSection
          tracks={tracks()}
          playingTrackId={null}
          onTogglePlayTrack={vi.fn()}
          onCutIdeaWithAgent={onCutIdeaWithAgent}
        />
      ),
    });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
    await act(async () => {
      render(
        <I18nProvider i18n={i18n}>
          <HostPlatformProvider platform="mac">
            <RouterProvider router={router} />
          </HostPlatformProvider>
        </I18nProvider>,
      );
      await router.load();
    });
    expect(screen.getByRole('heading', { name: 'Reel ideas' })).toBeTruthy();
    expect(screen.queryByText('An unrelated real track')).toBeNull();
    const links = screen.getAllByRole('link', { name: 'Use idea' });
    expect(links).toHaveLength(6);
    for (const link of links) expect(link.getAttribute('href')).not.toMatch(/audioAssetId|unrelated/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cut with AI' })[0]!);
    expect(onCutIdeaWithAgent).toHaveBeenCalledWith(getReelIdeas(i18n)[0], undefined);
  });
});
