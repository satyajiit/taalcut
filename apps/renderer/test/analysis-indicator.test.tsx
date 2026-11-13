// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-PROG: the window bar's analysis, from the indexing status: how many clips are being analysed (not the ones
// held for a model or their drive), how far, what most of the rest is, and the import line counting the same way.
// The popover's queue and its links are e2e (clip-progress.spec.ts).
import { I18nProvider } from '@lingui/react';
import type { ImportStatus, IndexingStatus, SourceId } from '@taalcut/core';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { AnalysisQueueView } from '../src/features/analysis/analysis-queue';
import { ImportMeta } from '../src/features/library/import-meta';
import { summariseAnalysis } from '../src/features/analysis/analysis-summary';
import { analysingCount, summariseImports } from '../src/features/library/import-summary';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';

beforeAll(() => activateLocale('en'));

const stage = (name: string, done: number, left: number, waitingForModel?: number) => ({
  stage: name,
  done,
  left,
  failed: 0,
  ...(waitingForModel === undefined ? {} : { waitingForModel }),
});

const source: ImportStatus = {
  sourceId: 'src_1' as SourceId,
  state: 'indexing',
  counts: { assets: 10, done: 4, active: 2, waiting: 4, failed: 0 },
  stages: [stage('vision.shots', 8, 2), stage('audio.transcript', 6, 4, 2), stage('vision.describe', 2, 8)],
  etaMs: 90_000,
  jobIds: [],
  updatedAt: 1,
};

const status = (over: Partial<IndexingStatus['overall']> = {}, paused = false): IndexingStatus => ({
  paused,
  overall: { assets: 10, done: 4, active: 2, waiting: 4, failed: 0, ...over },
  sources: [source],
  etaMs: 90_000,
  updatedAt: 1,
});

describe('the analysis indicator', () => {
  it('counts the clips running or waiting their turn, not those held for a model or their drive', () => {
    expect(analysingCount(status())).toBe(6);
    expect(analysingCount(status({ held: 3 }))).toBe(3);
    // Held clips are among the waiting ones: never below what runs.
    expect(analysingCount(status({ active: 1, waiting: 2, held: 5 }))).toBe(1);
    expect(summariseImports(status({ held: 4 }))).toMatchObject({ kind: 'running' });
    expect(summariseImports({ ...status({ active: 0, waiting: 2, held: 2 }), sources: [] })).toMatchObject({
      kind: 'none',
      analysing: 0,
    });
  });

  it('says how far the steps in hand are, what most of the rest is, and the library’s time left', () => {
    const summary = summariseAnalysis(status({ held: 1 }));
    expect(summary).toMatchObject({ count: 5, held: 1, paused: false, slowest: 'describe', etaMs: 90_000 });
    expect(summary?.fraction).toBeCloseTo(16 / 30);
    // Steps held for a model don't count as left to run.
    const listening = summariseAnalysis({
      ...status(),
      sources: [
        { ...source, stages: [stage('audio.transcript', 0, 9, 1), stage('vision.describe', 2, 6, 6)] },
      ],
    });
    expect(listening?.slowest).toBe('sound');
    expect(summariseAnalysis(status({}, true))).toMatchObject({ paused: true, etaMs: null });
    expect(summariseAnalysis(null)).toBeNull();
  });

  it('opens on the count, the time left, what most of the rest is and the clips held, with the way to the models', async () => {
    const summary = summariseAnalysis(status({ held: 2 }));
    if (!summary) throw new Error('no summary');
    const root = createRootRoute({
      component: () => (
        <I18nProvider i18n={i18n}>
          <AnalysisQueueView
            titleId="t"
            title="Analysing 4 clips"
            summary={summary}
            queue={{ items: [], total: 9, error: null, loaded: true }}
          />
        </I18nProvider>
      ),
    });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
    await act(async () => {
      render(<RouterProvider router={router} />);
      await router.load();
    });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Analysing 4 clips');
    expect(screen.getByText('About 2 min left')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Analysing 4 clips' }).getAttribute('aria-valuenow')).toBe(
      '53',
    );
    expect(screen.getByText('Most of what’s left is describing.')).toBeTruthy();
    expect(screen.getByText('And 4 more clips')).toBeTruthy();
    expect(screen.getByText('2 clips wait for a model or their drive.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Settings › Models' })).toBeTruthy();
  });

  it('says how many clips search finds for an import whose rest only waits, not "0 of 2" fully analysed', () => {
    // fix's profile run: two clips in, playable and found, each description waiting for the model that describes.
    const waiting: ImportStatus = {
      ...source,
      counts: { assets: 2, done: 0, active: 0, waiting: 2, failed: 0, searchable: 2, held: 2 },
      stages: [stage('vision.describe', 0, 2, 2)],
      etaMs: null,
      jobIds: [],
    };
    render(
      <I18nProvider i18n={i18n}>
        <ImportMeta status={waiting} lines={false} failed={0} />
      </I18nProvider>,
    );
    expect(screen.getByText('2 of 2 searchable')).toBeTruthy();
    expect(screen.queryByText('0 of 2')).toBeNull();
  });
});
