// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The clip page's status (LIB1-PROG, after UX2's): what the clip is good for already, what Taalcut does now and
// roughly how long is left, the steps grouped by what they give (Play it, Shots, Picture, Sound and words, Search,
// Description), live progress from the running step's job, Analyse again's redo, and every step behind "Show the
// steps", each saying why it was skipped or waits in the words the renderer owns for the library's reason keys.
import { I18nProvider } from '@lingui/react';
import { newId, type AssetDetail } from '@taalcut/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';
import { ClipStages } from '../src/features/library/clip/clip-stages';
import { ClipStatus } from '../src/features/library/clip/inspector/clip-status';
import { activateLocale, i18n } from '../src/i18n/i18n';

beforeAll(() => activateLocale('en'));

const withStages = (
  stages: AssetDetail['stages'],
  index: Partial<AssetDetail['asset']['index']> = {},
  asset: Partial<AssetDetail['asset']> = {},
): AssetDetail => ({
  ...CLIP_FIXTURE,
  asset: { ...CLIP_FIXTURE.asset, ...asset, index: { ...CLIP_FIXTURE.asset.index, ...index } },
  stages,
});

let fake = createFakeBackend();
/** In English, on the fake backend: the status follows its running step's job.progress events. */
const wrap = (node: React.ReactNode) => (
  <I18nProvider i18n={i18n}>
    <BackendProvider backend={fake.client}>{node}</BackendProvider>
  </I18nProvider>
);
const inEnglish = (node: React.ReactNode) => {
  fake = createFakeBackend();
  return render(wrap(node));
};

describe('a clip’s steps', () => {
  it('say why a step was skipped or waits', () => {
    inEnglish(
      <ClipStages
        stages={[
          { stage: 'library.hash', state: 'done' },
          { stage: 'audio.transcript', state: 'skipped', reasonKey: 'indexing.skip.silent' },
          { stage: 'vision.embed', state: 'waiting', reasonKey: 'library.stage.modelMissing' },
          { stage: 'vision.describe', state: 'waiting', reasonKey: 'library.stage.somethingNew' },
        ]}
      />,
    );
    const words = [...document.querySelectorAll('[data-slot=stage-reason]')].map((node) => node.textContent);
    expect(words).toEqual([
      'done',
      'Nobody speaks in this clip',
      // The catalogue's words for a model-held step say a download runs; the clip page says it waits.
      'waits for its model',
      'waiting',
    ]);
    expect(document.querySelectorAll('[data-milestone]')).toHaveLength(0);
  });

  it('fall under the groups the status shows, in its order', () => {
    inEnglish(
      <ClipStages
        stages={[
          { stage: 'library.hash', state: 'done', milestone: 'searchable' },
          { stage: 'vision.describe', state: 'running', milestone: 'complete' },
          { stage: 'vision.embed', state: 'done', milestone: 'searchable' },
          {
            stage: 'vision.embedText',
            state: 'skipped',
            reasonKey: 'indexing.skip.silent',
            milestone: 'searchable',
          },
        ]}
      />,
    );
    const groups = [...document.querySelectorAll('[data-group]')].map((group) => [
      group.querySelector('h3')?.textContent,
      [...group.querySelectorAll('li')].map((item) => item.textContent),
    ]);
    expect(groups).toEqual([
      ['Play it', ['Copying done']],
      ['Search', ['Indexing for search done', 'Indexing speech for search Nobody speaks in this clip']],
      ['Description', ['Describing now']],
    ]);
  });
});

describe('a clip’s status', () => {
  it('leads with what the clip is good for, says what runs now, and groups the steps by what they give', () => {
    inEnglish(
      <ClipStatus
        detail={withStages(
          [
            { stage: 'library.hash', state: 'done', milestone: 'searchable' },
            { stage: 'vision.embed', state: 'done', milestone: 'searchable' },
            { stage: 'vision.embedText', state: 'skipped', milestone: 'searchable' },
            { stage: 'vision.describe', state: 'running', milestone: 'complete' },
          ],
          { state: 'indexing', searchableAt: 1 },
          // A first analysis: nothing described yet (a description left from before would make it "again").
          { description: null },
        )}
      />,
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('You can search this clip now');
    expect(screen.getByText('Taalcut is describing it.')).toBeTruthy();
    const rows = [...document.querySelectorAll('[data-slot=clip-groups] [data-group]')].map((row) => [
      row.getAttribute('data-group'),
      row.getAttribute('data-state'),
    ]);
    expect(rows).toEqual([
      ['play', 'done'],
      ['search', 'done'],
      ['describe', 'now'],
    ]);
    // No ring of steps: the groups say it. The steps one by one are behind the disclosure, folded.
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show the steps' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('follows the running step’s job, and says roughly how long is left from this Mac’s step lengths', async () => {
    const jobId = newId<'Job'>();
    inEnglish(
      <ClipStatus
        detail={withStages(
          [
            { stage: 'library.hash', state: 'done' },
            {
              stage: 'audio.transcript',
              state: 'running',
              jobId,
              startedAt: Date.now() - 4_000,
              typicalMs: 3_400,
            },
            { stage: 'vision.describe', state: 'waiting', typicalMs: 7_500 },
          ],
          { state: 'indexing' },
        )}
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Sound and words' });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    // Overrun: a tenth of its usual length, plus the description to come: about 10 seconds.
    expect(document.querySelector('[data-slot=clip-time-left]')?.textContent).toBe('About 10 sec left');
    await act(async () => {
      // The page's subscription opens first.
      await new Promise((resolve) => setTimeout(resolve, 30));
      fake.controls.events.emit('job.progress', {
        jobId,
        kind: 'audio.transcribeAssetWhisper',
        projectId: null,
        progress: { fraction: 0.5 },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    // Half done in four seconds: four more, and the description's 7.5: about 15 seconds.
    expect(document.querySelector('[data-slot=clip-time-left]')?.textContent).toBe('About 15 sec left');
  });

  it('says Analyse again keeps what it found last time, and which parts it redoes', () => {
    inEnglish(
      <ClipStatus
        detail={withStages(
          [
            { stage: 'library.hash', state: 'done' },
            { stage: 'vision.shots', state: 'running' },
            { stage: 'audio.transcript', state: 'waiting' },
            { stage: 'vision.embed', state: 'waiting' },
          ],
          { state: 'indexing', searchableAt: null },
        )}
      />,
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Taalcut is analysing this clip again',
    );
    expect(screen.getByText('What Taalcut found last time stays until each part is redone.')).toBeTruthy();
    const words = [...document.querySelectorAll('[data-slot=clip-groups] [data-group]')].map((row) => [
      row.getAttribute('data-group'),
      row.querySelector('[data-slot=list-row] span span:nth-child(2)')?.textContent ?? row.textContent,
    ]);
    expect(words.map(([group]) => group)).toEqual(['play', 'shots', 'sound', 'search']);
    expect(screen.getByText('Redoing now')).toBeTruthy();
    expect(screen.getAllByText('To redo')).toHaveLength(2);
  });

  it('folds the steps away once it is done, behind a disclosure', () => {
    inEnglish(<ClipStatus detail={withStages([{ stage: 'library.hash', state: 'done' }])} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Taalcut has looked at all of this clip',
    );
    expect(screen.queryByRole('img')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Show the steps' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listitem')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide the steps' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('names a failure, offers Try again when it can help, and says why asking again failed', () => {
    const onRetry = vi.fn();
    const error = { code: 'media.unreadable', messageKey: 'errors.media.unreadable', retryable: true };
    const detail = withStages([
      { stage: 'library.hash', state: 'done' },
      { stage: 'media.normalise', state: 'failed', error },
    ]);
    const { rerender } = inEnglish(<ClipStatus detail={detail} onRetry={onRetry} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Taalcut couldn’t finish looking at this clip',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(
      wrap(
        <ClipStatus
          detail={detail}
          onRetry={onRetry}
          retryError={{ code: 'core.unavailable', messageKey: 'errors.core.unavailable', retryable: true }}
        />,
      ),
    );
    expect(screen.getByRole('button', { name: 'Try again' }).getAttribute('data-state')).toBe('error');
  });

  it('says a media error’s cause in the library’s words (the catalogue has them since UX1-IMPORT)', () => {
    // errorMessage (@taalcut/ui) has no errors.media.* entry of its own; it finds the renderer catalogue's.
    for (const [code, words] of [
      ['media.probe_failed', 'Taalcut couldn’t read this file. It may be damaged or only partly copied.'],
      ['media.unsupported_media', 'This file is in a format Taalcut doesn’t read yet.'],
      ['media.decode_failed', 'Part of this clip couldn’t be decoded. It may be damaged.'],
    ] as const) {
      const error = { code, messageKey: `errors.${code}`, retryable: false };
      const { unmount } = inEnglish(
        <ClipStatus
          detail={withStages([
            { stage: 'library.hash', state: 'done' },
            { stage: 'media.normalise', state: 'failed', error },
          ])}
        />,
      );
      expect(screen.getByText('Stopped at: Preparing')).toBeTruthy();
      expect(screen.getByText(words)).toBeTruthy();
      unmount();
    }
  });

  it('says the speech engine isn’t available, and what to do, when a speech step fails for it (UX2 round 5)', () => {
    // audio.engine_unavailable isn't retryable, so the clip page offers Analyse again; the words point there too.
    const onRetry = vi.fn();
    const error = {
      code: 'audio.engine_unavailable',
      messageKey: 'errors.audio.engine_unavailable',
      retryable: false,
      params: { engine: 'whisper' },
    };
    const detail = withStages([
      { stage: 'library.hash', state: 'done' },
      { stage: 'audio.language', state: 'failed', error },
    ]);
    inEnglish(<ClipStatus detail={detail} onRetry={onRetry} retryKind="reanalyse" />);
    expect(screen.getByText('Stopped at: Listening')).toBeTruthy();
    expect(
      screen.getByText(
        'The speech engine isn’t available right now. Analyse the clip again, and if it still fails, check Speech in Settings › Models.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Analyse again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says where it stopped, keeps the generic cause out, and offers a fresh start when retrying can’t help', () => {
    const onRetry = vi.fn();
    const error = { code: 'media.unreadable', messageKey: 'errors.media.unreadable', retryable: false };
    const detail = withStages([
      { stage: 'library.hash', state: 'done' },
      { stage: 'media.normalise', state: 'failed', error },
    ]);
    inEnglish(<ClipStatus detail={detail} onRetry={onRetry} retryKind="reanalyse" />);
    expect(screen.getByText('Stopped at: Preparing')).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Analyse again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
