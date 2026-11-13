// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2: a clip held for on-device models says which ones (from the steps they hold), how many steps start after
// them, and offers the way out: Download (UX2-DOWNLOADER: components.download with those models first) with their
// jobs' rows, then a quiet line once they're on this Mac; a download that fails says so, with Try again. Not
// "7 of 14 steps", as if it were working: the groups say which wait for a model (LIB1-PROG).
import { I18nProvider } from '@lingui/react';
import { callRpc, type AssetDetail, type Downloads } from '@taalcut/core';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { modelWaitOf } from '../src/features/library/clip/clip-facts-data';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';
import { ClipStatus } from '../src/features/library/clip/inspector/clip-status';
import { activateLocale, i18n } from '../src/i18n/i18n';

beforeAll(() => activateLocale('en'));

const HELD = 'library.stage.modelMissing';
/** The PO's two phone clips: seven steps done, five held for a model, two behind them. */
const STAGES: AssetDetail['stages'] = [
  ...['library.hash', 'media.normalise', 'media.thumbnail', 'vision.shots', 'vision.analyse'].map(
    (stage) => ({
      stage,
      state: 'done' as const,
    }),
  ),
  { stage: 'vision.ocr', state: 'waiting' },
  { stage: 'vision.embed', state: 'waiting', reasonKey: HELD },
  { stage: 'vision.embedOcr', state: 'waiting', reasonKey: HELD },
  {
    stage: 'audio.language',
    state: 'waiting',
    reasonKey: HELD,
    error: {
      code: 'audio.model_missing',
      messageKey: 'errors.audio.model_missing',
      params: { component: 'whisper-tiny' },
      retryable: false,
    },
  },
  { stage: 'audio.transcript', state: 'waiting' },
  { stage: 'vision.embedText', state: 'waiting', reasonKey: HELD },
  { stage: 'media.proxy', state: 'done' },
  { stage: 'media.previews', state: 'done' },
  { stage: 'vision.describe', state: 'waiting', reasonKey: HELD },
];

const detail: AssetDetail = {
  ...CLIP_FIXTURE,
  // Search can't find it yet: the steps that index it wait for the search model. Nothing heard or described yet.
  asset: {
    ...CLIP_FIXTURE.asset,
    description: null,
    language: null,
    index: { state: 'waiting', done: 7, total: 14, searchableAt: null },
  },
  transcript: null,
  stages: STAGES,
};

/** The indexing models aren't on this Mac (or one of them won't download). In a router: it links. */
async function renderWithoutModels(
  node: React.ReactNode,
  models: 'missing' | 'broken' = 'missing',
  downloadTickMs = 0,
) {
  const fake = createFakeBackend({
    phase2b: {
      onboarding: {
        downloadTickMs,
        models,
        saved: { step: 'first-video', startedAt: 0, completedAt: 1, branch: {}, completedVia: 'finished' },
      },
    },
  });
  const root = createRootRoute({
    component: () => (
      <I18nProvider i18n={i18n}>
        <BackendProvider backend={fake.client}>{node}</BackendProvider>
      </I18nProvider>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  await act(async () => {
    render(<RouterProvider router={router} />);
    await router.load();
  });
  return fake;
}

describe('waiting for models', () => {
  it('knows which models from the steps they hold, and which steps wait behind them', () => {
    const wait = modelWaitOf(STAGES);
    expect(wait?.held.map((stage) => stage.stage)).toEqual([
      'vision.embed',
      'vision.embedOcr',
      'audio.language',
      'vision.embedText',
      'vision.describe',
    ]);
    expect(wait?.behind.map((stage) => stage.stage)).toEqual(['vision.ocr', 'audio.transcript']);
    expect(wait).toMatchObject({ speech: true, search: true });
    expect(modelWaitOf(STAGES.filter((stage) => !stage.stage.startsWith('audio.')))).toMatchObject({
      speech: false,
      search: true,
    });
    expect(modelWaitOf(STAGES.filter((stage) => stage.reasonKey !== HELD))).toBeNull();
  });

  it('says a clip whose only wait is its description waits for the model that describes, and leads with what it can do', async () => {
    // LIB1-FIX: Qwen3.5 4B (about 3 GB) still downloading while search's model is here: every Recommended Mac's
    // first import. A description held beside an embedding step waits for the search model instead.
    const describing: AssetDetail['stages'] = STAGES.map((stage) =>
      stage.stage === 'vision.describe' ? stage : { stage: stage.stage, state: 'done' as const },
    );
    expect(modelWaitOf(describing)).toMatchObject({
      speech: false,
      text: false,
      search: false,
      describe: true,
    });
    expect(modelWaitOf(STAGES)).toMatchObject({ search: true, describe: false });
    const speechToo = describing.map((stage) =>
      stage.stage === 'audio.language' ? { ...stage, state: 'waiting' as const, reasonKey: HELD } : stage,
    );
    expect(modelWaitOf(speechToo)).toMatchObject({ speech: true, search: false, describe: true });

    await renderWithoutModels(
      <ClipStatus
        detail={{
          ...detail,
          asset: {
            ...detail.asset,
            index: { state: 'waiting', done: 14, total: 15, searchableAt: 1, held: 'model' },
          },
          playback: {
            source: 'original',
            width: 1080,
            height: 1920,
            duration: { value: 900, rate: { num: 30, den: 1 } },
            frameRate: { num: 30, den: 1 },
          },
          stages: describing,
        }}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'You can play and search this clip now',
      'Waiting for the model that describes clips',
    ]);
    expect(
      [...document.querySelectorAll('[data-slot=clip-groups] [data-state=model]')].map((row) =>
        row.getAttribute('data-group'),
      ),
    ).toEqual(['describe']);
  });

  it('says what it waits for and offers the download, with its progress, until the models are here', async () => {
    await renderWithoutModels(<ClipStatus detail={detail} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Taalcut is still looking at this clip',
      'Waiting for the speech and search models',
    ]);
    expect(screen.getByText('7 steps start by themselves once they’re on this Mac.')).toBeTruthy();
    // The groups say what waits for a model, and nothing reads as if it were working.
    expect(
      [...document.querySelectorAll('[data-slot=clip-groups] [data-state=model]')].map((row) =>
        row.getAttribute('data-group'),
      ),
    ).toEqual(['sound', 'search', 'describe']);
    expect(screen.queryByText(/of 14 steps/)).toBeNull();
    expect(document.querySelector('[data-slot=clip-now]')).toBeNull();
    const download = await screen.findByRole('button', { name: /^Download the models · / });
    const rows = within(screen.getByRole('list', { name: 'Models this clip needs' })).getAllByRole(
      'listitem',
    );
    // By job, in the jobs' order: the clip's speech and search models.
    expect(rows.map((row) => row.dataset['job'])).toEqual(['speech', 'search']);
    await act(async () => {
      fireEvent.click(download);
    });
    expect(
      await screen.findByText(
        'The models are on this Mac. The steps start by themselves.',
        {},
        { timeout: 4000 },
      ),
    ).toBeTruthy();
  });

  it('once asked, the offer stays away while the models wait their turn, and the whole download says how it goes', async () => {
    // The PO's Mac: bigger parts held the download's lanes, so after the press the clip's models waited ("Waiting"),
    // and the offer came back as if the press had done nothing; pressed again, nothing happened.
    const fake = await renderWithoutModels(<ClipStatus detail={detail} />, 'missing', 60_000);
    const download = await screen.findByRole('button', { name: /^Download the models · / });
    await act(async () => {
      fireEvent.click(download);
    });
    const read = await callRpc(fake.client.system.downloads(undefined));
    if (!read.ok) throw new Error(read.error.code);
    const clips = new Set(
      read.value.components.filter((each) => each.status === 'downloading').map((each) => each.id),
    );
    expect(clips.size).toBeGreaterThan(0);
    const busy = read.value.components.find((each) => !clips.has(each.id))!;
    const waiting: Downloads = {
      ...read.value,
      state: 'downloading',
      bytesPerSecond: 21_000_000,
      components: read.value.components.map((each) =>
        clips.has(each.id)
          ? { ...each, status: 'queued', bytesDone: 0, step: undefined }
          : each.id === busy.id
            ? { ...each, status: 'downloading', step: 'downloading', bytesDone: 1 }
            : each,
      ),
    };
    await act(async () => {
      fake.controls.events.emit('components.downloads', waiting);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const list = screen.getByRole('list', { name: 'Models this clip needs' });
    const card = list.parentElement!;
    for (const row of within(list).getAllByRole('listitem')) expect(row.textContent).toMatch(/Waiting · /);
    expect(within(card).queryByRole('button', { name: /^Download/ })).toBeNull();
    // Its rows are some of a bigger download: the line under them says what the whole download is doing (here the
    // busy part, and the Core ML copy of the search model that isn't one of the clip's rows).
    const whole = card.querySelector('[data-slot=clip-models-whole]');
    expect(whole?.textContent).toMatch(/^Everything this (Mac|computer) needs[^·]+·21 MB\/s/);
    expect(whole?.textContent).toContain('2 more parts are on their way with these. See every part');
  });

  it('says plainly when a model doesn’t download, and offers Try again in place of Download', async () => {
    await renderWithoutModels(<ClipStatus detail={detail} />, 'broken');
    const download = await screen.findByRole('button', { name: /^Download the models · / });
    await act(async () => {
      fireEvent.click(download);
    });
    expect(await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Download the models · / })).toBeNull();
    expect(screen.getByText('Didn’t download')).toBeTruthy();
  });

  it('shows the card under the running line when a step still runs beside the held ones', async () => {
    await renderWithoutModels(
      <ClipStatus
        detail={{
          ...detail,
          stages: STAGES.map((stage) =>
            stage.stage === 'media.previews' ? { ...stage, state: 'running' } : stage,
          ),
        }}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Taalcut is still looking at this clip',
      'Waiting for the speech and search models',
    ]);
    expect(screen.getByText('Taalcut is getting it ready to play.')).toBeTruthy();
  });
});
