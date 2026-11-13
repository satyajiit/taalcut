// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { CardOf, QaReport, RenderId, RenderSnapshot } from '@taalcut/core';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_FIXTURES, CardView, type CardData } from '../src/index';
import { failed, ok, wrap } from './make-fixture';
import { ORIGINAL, PROJECT, renderSnapshot, SECOND, THIRD } from './variants-fixture';

const R1 = '01K7C5M6Q8R000000000000001' as RenderId;
const R2 = '01K7C5M6Q8R000000000000002' as RenderId;
const R3 = '01K7C5M6Q8R000000000000003' as RenderId;
const BATCH = CARD_FIXTURES.renderBatch.running!.progress.batchId;

/** Three videos, each with its render: one exported, one rendering, one waiting. */
const batch = (
  statuses: readonly CardOf<'renderBatch'>['items'][number]['status'][],
): CardOf<'renderBatch'> => {
  const ids = [R1, R2, R3];
  const timelines = [ORIGINAL, SECOND, THIRD];
  const items = statuses.map((status, index) => ({
    projectId: PROJECT,
    timelineId: timelines[index]!,
    renderId: ids[index]!,
    presetId: 'reels' as const,
    status,
  }));
  const count = (status: string) => statuses.filter((each) => each === status).length;
  return {
    type: 'renderBatch',
    id: 'batch',
    version: 1,
    progress: {
      batchId: BATCH,
      total: items.length,
      queued: count('queued'),
      running: count('running'),
      ready: count('ready'),
      needsAttention: count('needsAttention'),
      failed: count('failed'),
      cancelled: count('cancelled'),
      etaMs: 95_000,
    },
    items,
  };
};

/** CardData whose renders are these snapshots, by id. */
const rendersData = (
  renders: Readonly<Record<string, RenderSnapshot>>,
  extra: Partial<CardData> = {},
): CardData => ({
  watchRender: (id, onChange) => {
    onChange(renders[id] ?? null);
    return () => undefined;
  },
  ...extra,
});

const live = (id: RenderId, status: RenderSnapshot['status'], extra: Partial<RenderSnapshot> = {}) =>
  renderSnapshot(ORIGINAL, status, { id, name: `Video ${id.slice(-1)}`, ...extra });

describe('renderBatch card (U-5)', () => {
  it('says how many videos are in the queue, folds their progress and shows a row each', () => {
    wrap(<CardView card={batch(['ready', 'running', 'queued'])} />, { dispatch: vi.fn() });
    expect(screen.getByText('3 videos in one queue')).toBeTruthy();
    expect(screen.getByText('1 ready · 1 exporting · 1 waiting')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Batch progress' })).toBeTruthy();
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('PT95S');
    expect(document.querySelectorAll('[data-slot=batch-row]')).toHaveLength(3);
    expect(screen.getByText('Video 2')).toBeTruthy();
  });

  it('moves with each render: the live states fold into the summary', () => {
    const renders = {
      [R1]: live(R1, 'ready', { finishedAt: 60_000 }),
      [R2]: live(R2, 'needsAttention', { finishedAt: 120_000 }),
      [R3]: live(R3, 'rendering', { progress: { fraction: 0.5, etaMs: 30_000 } }),
    };
    wrap(<CardView card={batch(['ready', 'running', 'queued'])} />, {}, rendersData(renders));
    expect(screen.getByText('1 ready · 1 needs review · 1 exporting')).toBeTruthy();
    expect(screen.getByText('Video 3')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Batch progress' }).getAttribute('aria-valuenow')).toBe(
      '83',
    );
  });

  it('Cancel the rest sends render.cancelBatch; Notify me sets every video still going', async () => {
    const dispatch = vi.fn().mockResolvedValue(ok());
    const renders = {
      [R1]: live(R1, 'ready'),
      [R2]: live(R2, 'rendering', { progress: { fraction: 0.2 } }),
      [R3]: live(R3, 'queued'),
    };
    wrap(<CardView card={batch(['ready', 'running', 'queued'])} />, { dispatch }, rendersData(renders));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the rest' }));
    expect(dispatch).toHaveBeenLastCalledWith('render.cancelBatch', { batchId: BATCH });
    fireEvent.click(screen.getByRole('switch', { name: 'Notify me when they’re done' }));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(3));
    expect(dispatch.mock.calls.slice(1)).toEqual([
      ['render.setNotify', { projectId: PROJECT, renderId: R2, notify: true }],
      ['render.setNotify', { projectId: PROJECT, renderId: R3, notify: true }],
    ]);
  });

  it('a ready row shows its file; a row that needs a look opens its QA report', async () => {
    const reveal = vi.fn().mockResolvedValue(ok());
    const report: QaReport = {
      version: 1,
      renderId: R2,
      round: 1,
      verdict: 'needsAttention',
      presetId: 'reels',
      checks: [
        {
          id: 'loudness',
          status: 'fail',
          labelKey: 'qa.checks.loudness',
          measured: { value: -9, unit: 'lufs' },
          findings: [],
          overridable: true,
          fixes: [],
          durationMs: 40,
        },
      ],
      overrides: [],
      createdAt: 0,
    };
    const qaReport = vi.fn().mockResolvedValue(report);
    const renders = { [R1]: live(R1, 'ready'), [R2]: live(R2, 'needsAttention'), [R3]: live(R3, 'failed') };
    wrap(
      <CardView card={batch(['ready', 'needsAttention', 'failed'])} />,
      { reveal },
      rendersData(renders, { qaReport }),
    );
    expect(screen.queryByRole('button', { name: 'Cancel the rest' })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    const rows = document.querySelectorAll<HTMLElement>('[data-slot=batch-row]');
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Show' }));
    expect(reveal).toHaveBeenCalledWith(R1);
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Review' }));
    await vi.waitFor(() => expect(qaReport).toHaveBeenCalledWith(R2));
    expect(await within(rows[1]!).findByRole('button', { name: /Export anyway/ })).toBeTruthy();
    expect(within(rows[2]!).getByText(/Didn’t finish/)).toBeTruthy();
  });

  it('waits for the approval above before anything is queued', () => {
    wrap(<CardView card={CARD_FIXTURES.renderBatch.waiting!} />);
    expect(screen.getByText('Waiting for your OK on the export above.')).toBeTruthy();
  });

  it('shows a refused command’s cause', async () => {
    const dispatch = vi.fn().mockResolvedValue(failed('core.not_found'));
    wrap(<CardView card={batch(['running', 'queued', 'queued'])} />, { dispatch });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the rest' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
