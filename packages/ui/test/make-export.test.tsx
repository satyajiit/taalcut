// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { CardOf, ExportOptions, QaReport, RenderSnapshot } from '@taalcut/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CardView,
  ExportReview,
  MAKE_FIXTURE_IDS,
  MAKE_FIXTURES,
  type CardActions,
  type CardData,
} from '../src/index';
import { RATE, TEMPLATE, failed, makeTimeline, ok, timelineData, wrap } from './make-fixture';

// decide answers with how it went (UX round 1); these tests answer as the run would.
const answered = { ok: true as const, value: 'answered' as const };

const { project: PROJECT, timeline: TIMELINE, render: RENDER } = MAKE_FIXTURE_IDS;

const options = (): ExportOptions => ({
  projectId: PROJECT,
  timelineId: TIMELINE,
  timelineRevision: 3,
  rate: RATE,
  durationFrames: 135,
  presets: [],
  defaultPresetId: 'reels',
  music: {
    current: { path: 'platformSound' },
    referenceAudioAvailable: true,
    referenceAudioAcknowledged: true,
    platformSound: null,
  },
  captions: { available: true, enabled: true, language: 'en' },
});

const exportData = (extra: Partial<CardData> = {}) =>
  timelineData(makeTimeline(), { exportOptions: () => Promise.resolve(options()), ...extra });

const snapshot = (status: RenderSnapshot['status'], extra: Partial<RenderSnapshot> = {}): RenderSnapshot => ({
  id: RENDER,
  projectId: PROJECT,
  timelineId: TIMELINE,
  timelineRevision: 3,
  presetId: 'reels',
  status,
  jobId: null,
  progress: null,
  name: 'Golden hour market',
  width: 1080,
  height: 1920,
  rate: RATE,
  durationFrames: 450,
  bytes: 12_400_000,
  music: 'platformSound',
  captions: { burnIn: true, sidecars: [] },
  qa: null,
  supersedes: null,
  notify: false,
  error: null,
  credentials: { added: false, state: null },
  batchId: null,
  createdAt: 0,
  finishedAt: null,
  deletedAt: null,
  ...extra,
});
const renderData = (render: RenderSnapshot | null, extra: Partial<CardData> = {}): CardData => ({
  watchRender: (_id, onChange) => {
    onChange(render);
    return () => undefined;
  },
  ...extra,
});

const report: QaReport = {
  version: 1,
  renderId: RENDER,
  round: 2,
  verdict: 'needsAttention',
  presetId: 'reels',
  checks: [
    ...MAKE_FIXTURES.qaReport.needsAttention.checks.map((check) => ({
      ...check,
      findings: [],
      durationMs: 12,
    })),
    {
      id: 'loudness',
      status: 'pass',
      labelKey: 'qa.checks.loudness',
      measured: { value: -14.2, unit: 'lufs' },
      findings: [],
      overridable: true,
      fixes: [],
      durationMs: 40,
    },
  ],
  overrides: [],
  createdAt: 0,
};

/**
 * UX4 (B8): the approval is made on its review page (ExportReview); the choices besides Export are behind Options,
 * opened here unless `closed`.
 */
function review(
  card: CardOf<'exportApproval'>,
  actions: CardActions,
  data: CardData,
  { onBack = vi.fn(), closed = false }: { onBack?: () => void; closed?: boolean } = {},
) {
  const rendered = wrap(<ExportReview card={card} onBack={onBack} />, actions, data);
  if (!closed) fireEvent.click(screen.getByRole('button', { name: 'Options' }));
  return rendered;
}

describe('export approval: the review page', () => {
  const card = MAKE_FIXTURES.exportApproval.pending;
  const exportButton = () => screen.getByRole('button', { name: 'Export' });

  it('exports with the agent’s choices as they are: the approval alone, then back to the chat', async () => {
    const decide = vi.fn(() => Promise.resolve(answered));
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    const onBack = vi.fn();
    review(card, { decide, dispatch }, exportData(), { onBack, closed: true });
    fireEvent.click(exportButton());
    await waitFor(() => expect(decide).toHaveBeenCalledWith('ap-export', 'approve'));
    expect(dispatch).not.toHaveBeenCalled();
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce());
  });

  it('saves a changed preset before it answers the approval', async () => {
    const decide = vi.fn(() => Promise.resolve(answered));
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    review(card, { decide, dispatch }, exportData());
    fireEvent.click(screen.getByRole('radio', { name: 'YouTube Shorts' }));
    fireEvent.click(exportButton());
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(dispatch).toHaveBeenCalledWith('render.setExportPreset', {
      projectId: PROJECT,
      timelineId: TIMELINE,
      presetId: 'shorts',
      captions: { burnIn: true, sidecars: [] },
    });
    expect(dispatch.mock.invocationCallOrder[0]!).toBeLessThan(decide.mock.invocationCallOrder[0]!);
  });

  it('sends no approval when saving the preset fails', async () => {
    const decide = vi.fn(() => Promise.resolve(answered));
    const dispatch = vi.fn(() => Promise.resolve(failed()));
    review(card, { decide, dispatch }, exportData());
    fireEvent.click(screen.getByRole('radio', { name: 'TikTok' }));
    fireEvent.click(exportButton());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(dispatch).toHaveBeenCalledWith(
      'render.setExportPreset',
      expect.objectContaining({ presetId: 'tiktok' }),
    );
    expect(decide).not.toHaveBeenCalled();
  });

  it('puts the reel’s music in with the switch, with no warning first (REF1)', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    review(card, { decide: vi.fn(), dispatch }, exportData());
    const music = await screen.findByRole('switch', { name: 'Music in the video' });
    await waitFor(() => expect(music.getAttribute('aria-disabled')).toBeNull());
    expect(screen.getByText('Instagram and YouTube may mute music added outside their apps.')).toBeTruthy();
    fireEvent.click(music);
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('music.choosePath', {
        projectId: PROJECT,
        timelineId: TIMELINE,
        choice: { path: 'referenceAudio', templateId: TEMPLATE, gainDb: 0 },
      }),
    );
    expect(screen.queryByRole('button', { name: 'I understand' })).toBeNull();
  });

  it('turns burnt-in captions off, and back on when that fails', async () => {
    const dispatch = vi.fn(() => Promise.resolve(failed()));
    review(card, { decide: vi.fn(), dispatch }, exportData());
    const captions = screen.getByRole('switch', { name: 'Captions in the video' });
    expect(captions.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(captions);
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('captions.setEnabled', {
        projectId: PROJECT,
        timelineId: TIMELINE,
        enabled: false,
      }),
    );
    await waitFor(() => expect(captions.getAttribute('aria-checked')).toBe('true'));
  });

  it('declines with Not now and opens the editor’s export dialog from Options', async () => {
    const decide = vi.fn(() => Promise.resolve(answered));
    const navigate = vi.fn();
    review(card, { decide, navigate, dispatch: vi.fn() }, exportData());
    fireEvent.click(screen.getByRole('button', { name: 'Open in the editor' }));
    expect(navigate).toHaveBeenCalledWith({
      to: 'timeline',
      projectId: PROJECT,
      timelineId: TIMELINE,
      exportDialog: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith('ap-export', 'deny'));
  });

  it('waits for the new preview after a swap', () => {
    review(MAKE_FIXTURES.exportApproval.updating, { decide: vi.fn(), dispatch: vi.fn() }, exportData());
    expect(screen.getByText('Updating with your swap…')).toBeTruthy();
    expect(screen.getByText('Export waits for the new preview.')).toBeTruthy();
    expect((exportButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['exported', 'Exported'],
    ['declined', 'Not exported. Say when you’re ready.'],
    ['expired', 'This run ended.'],
  ] as const)('settles when %s', (status, words) => {
    review(MAKE_FIXTURES.exportApproval[status], { decide: vi.fn() }, exportData(), { closed: true });
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });
});

describe('QA report card', () => {
  const card = MAKE_FIXTURES.qaReport.needsAttention;

  it('runs a ready fix as its command, and asks the agent for the other', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    const ask = vi.fn();
    wrap(<CardView card={card} />, { dispatch, ask });
    expect(screen.getByText('Checked: 18 of 20 passed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move the captions' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('captions.setStyle', {
        projectId: PROJECT,
        timelineId: TIMELINE,
        style: { anchorY: 0.52 },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Swap or trim the still part' }));
    await waitFor(() =>
      expect(ask).toHaveBeenCalledWith('No frozen picture: Swap or trim the still part', []),
    );
  });

  it('exports anyway with every failing check', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={card} />, { dispatch });
    expect(screen.getByText('Taalcut keeps a note that you chose this.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export anyway' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('render.overrideQa', {
        projectId: PROJECT,
        renderId: RENDER,
        checks: ['captionSafeZone', 'frozenFrames'],
      }),
    );
  });

  it('opens every check with what was measured, and retries a failed load', async () => {
    const qaReport = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(report);
    wrap(<CardView card={card} />, {}, { qaReport });
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(await screen.findByText('The details didn’t load.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('-14.2 LUFS')).toBeTruthy();
    expect(screen.getByText('Loudness')).toBeTruthy();
    expect(qaReport).toHaveBeenCalledWith(RENDER);
  });

  it('says it is checking while the Reviewer works', () => {
    wrap(<CardView card={MAKE_FIXTURES.qaReport.checking} />);
    expect(screen.getByText('Checking your video…')).toBeTruthy();
  });
});

describe('render progress card', () => {
  const card: CardOf<'renderProgress'> = MAKE_FIXTURES.renderProgress.rendering;
  const progress = { fraction: 0.42, stageKey: 'render.stage.capturing', etaMs: 38_000 };

  it('shows the stage and the percent, cancels, and asks to be told', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={card} />, { dispatch }, renderData(snapshot('rendering', { progress })));
    const bar = screen.getByRole('progressbar', { name: 'Export progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.getAttribute('aria-valuetext')).toBe('Exporting, 42%');
    fireEvent.click(screen.getByRole('switch', { name: 'Notify me when it’s done' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('render.setNotify', {
        projectId: PROJECT,
        renderId: RENDER,
        notify: true,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('render.cancel', { projectId: PROJECT, renderId: RENDER }),
    );
  });

  it('can’t be stopped while it checks', () => {
    wrap(<CardView card={card} />, { dispatch: vi.fn() }, renderData(snapshot('checking', { progress })));
    expect(screen.getByText('Almost done: it can’t be stopped now.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reveals the file and asks once whether you would post it', async () => {
    const reveal = vi.fn(() => Promise.resolve(ok()));
    const answer = vi.fn(() => Promise.resolve(ok()));
    const survey = { asked: () => false, answer };
    wrap(
      <CardView card={MAKE_FIXTURES.renderProgress.ready} />,
      { reveal, survey },
      renderData(snapshot('ready')),
    );
    expect(screen.getByText('Golden hour market')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show in Finder' }));
    expect(reveal).toHaveBeenCalledWith(RENDER);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Would you post this?' })).getByRole('button', {
        name: 'Yes',
      }),
    );
    expect(answer).toHaveBeenCalledWith(RENDER, 'yes');
    expect(await screen.findByText('Thanks. That helps.')).toBeTruthy();
  });

  it('tries a failed export again with the same choices', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(
      <CardView card={MAKE_FIXTURES.renderProgress.failed} />,
      { dispatch },
      renderData(snapshot('failed')),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('render.export', {
        projectId: PROJECT,
        timelineId: TIMELINE,
        presetId: 'reels',
        captions: { burnIn: true, sidecars: [] },
        notify: false,
      }),
    );
  });

  it('opens the checks from Review when it needs a look', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    const qaReport = vi.fn(() => Promise.resolve(report));
    const qa = MAKE_FIXTURES.renderProgress.needsAttention.qa;
    wrap(
      <CardView card={MAKE_FIXTURES.renderProgress.needsAttention} />,
      { dispatch },
      renderData(snapshot('needsAttention', { qa }), { qaReport }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Export anyway' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('render.overrideQa', {
        projectId: PROJECT,
        renderId: RENDER,
        checks: ['captionSafeZone', 'frozenFrames'],
      }),
    );
  });

  it('says a gone render was deleted', () => {
    wrap(<CardView card={card} />, {}, renderData(null));
    expect(screen.getByText('This export was deleted.')).toBeTruthy();
  });
});
