// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX1-IMPORT: an import's failures and waits, said the way they are. Files that couldn't be read are named by kind
 * with why and what to do (See which, Try again, Leave them out); clips whose analysis didn't finish are not called
 * unreadable; an import that ended with failed files says its clips are in instead of "stopped"; a stopped one says
 * why; one whose clips all wait (nothing running) says what for, without a spinner or Pause.
 */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ImportStatus } from '@taalcut/core';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  CARD_FIXTURES,
  ImportProgressView,
  importFailures,
  modelWaits,
  type ImportProgressViewProps,
} from '../src/index';

const base = (): ImportStatus => {
  const card = CARD_FIXTURES.importProgress['someFailed'];
  if (!card || card.type !== 'importProgress') throw new Error('no someFailed fixture');
  return card.status;
};

/** The someFailed fixture (2 failed in media.normalise, 31 of 40 done), changed by `edit`. */
const status = (edit: Partial<ImportStatus> = {}): ImportStatus => ({ ...base(), ...edit });

/** Two clips whose analysis failed (vision.shots), none unreadable. */
const analysisFailed = (): ImportStatus =>
  status({
    stages: base().stages.map((stage) => ({ ...stage, failed: stage.stage === 'vision.shots' ? 2 : 0 })),
  });

function view(props: Partial<ImportProgressViewProps> & { status: ImportStatus }, list?: ReactNode) {
  render(
    <I18nProvider i18n={i18n}>
      <ImportProgressView source="Goa" variant="strip" failedList={list} {...props} />
    </I18nProvider>,
  );
  return screen.getByRole('region', { name: 'Import progress' });
}

describe('import failures', () => {
  it('splits files that could not be read from clips whose analysis did not finish', () => {
    expect(importFailures(status())).toEqual({ unreadable: 2, unanalysed: 0 });
    expect(importFailures(analysisFailed())).toEqual({ unreadable: 0, unanalysed: 2 });
  });

  it('names unreadable files by kind, says why and offers See which, Try again and Leave them out', () => {
    const onSeeFailed = vi.fn();
    const onRetry = vi.fn();
    const onLeaveOut = vi.fn();
    const region = view({ status: status(), failedKinds: { video: 2 }, onSeeFailed, onRetry, onLeaveOut });
    expect(region.textContent).toContain('from Goa');
    expect(region.textContent).toContain('2 videos couldn’t be read.');
    expect(region.textContent).toContain('They may be damaged or in a format Taalcut doesn’t read yet.');
    fireEvent.click(screen.getByRole('button', { name: 'See which' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave them out' }));
    expect([onSeeFailed, onRetry, onLeaveOut].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('says files when the kinds are mixed or unknown', () => {
    const region = view({ status: status(), failedKinds: { video: 1, image: 1 } });
    expect(region.textContent).toContain('2 files couldn’t be read.');
  });

  it('never calls clips whose analysis failed unreadable, and offers no Leave them out for them', () => {
    const region = view({ status: analysisFailed(), onRetry: vi.fn(), onLeaveOut: vi.fn() });
    expect(region.textContent).toContain('Taalcut couldn’t finish analysing 2 clips.');
    expect(region.textContent).toContain('They play as usual, but search may miss them.');
    expect(region.textContent).not.toContain('couldn’t be read');
    expect(screen.queryByRole('button', { name: 'Leave them out' })).toBeNull();
  });

  it('shows Show all clips and the list while See which is open', () => {
    const onHideFailed = vi.fn();
    view(
      { status: status(), failedOpen: true, failedListId: 'failed-list', onHideFailed, onSeeFailed: vi.fn() },
      <p id="failed-list">the list</p>,
    );
    const toggle = screen.getByRole('button', { name: 'Show all clips' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('failed-list');
    expect(screen.getByText('the list')).toBeTruthy();
    fireEvent.click(toggle);
    expect(onHideFailed).toHaveBeenCalledOnce();
  });

  it('shows the action in flight and holds the others', () => {
    view({ status: status(), pending: 'leave', onSeeFailed: vi.fn(), onRetry: vi.fn(), onLeaveOut: vi.fn() });
    const leave = screen.getByRole('button', { name: 'Leave them out' });
    expect(leave.getAttribute('aria-busy')).toBe('true');
    expect(leave.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Try again' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('how an import ended or waits', () => {
  it('says the clips are in when it ended with failed files, not that it stopped', () => {
    const counts = { ...base().counts, active: 0, waiting: 0, done: 38, failed: 2 };
    const region = view({ status: status({ state: 'failed', counts }), onRetry: vi.fn() });
    expect(region.dataset['outcome']).toBe('ended-with-failures');
    expect(region.textContent).toContain('Clips from Goa are in');
    expect(region.textContent).not.toContain('stopped');
    expect(screen.queryByRole('progressbar')).toBeNull();
    // Try again lives in the failed line, once.
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
  });

  it('says none came in when every file failed', () => {
    const counts = { assets: 2, done: 0, active: 0, waiting: 0, failed: 2, searchable: 0 };
    const region = view({ status: status({ state: 'failed', counts }) });
    expect(region.textContent).toContain('None of the clips from Goa could be brought in');
  });

  it('says why a stopped import stopped, or what to check', () => {
    const counts = { ...base().counts, failed: 0 };
    const stopped = status({ state: 'failed', counts });
    const withCause = view({
      status: stopped,
      stoppedBecause: { code: 'core.unknown', messageKey: 'errors.core.unknown', retryable: false },
    });
    expect(withCause.querySelector('[data-slot=import-stopped]')?.textContent).not.toBe('');
    withCause.parentElement?.remove();
    const plain = view({ status: stopped });
    expect(plain.textContent).toContain('Check that it is still connected, then try again.');
  });

  it('waits without a spinner or Pause when every clip waits and nothing runs', () => {
    const onOpenModels = vi.fn();
    const counts = { assets: 2, done: 0, active: 0, waiting: 2, failed: 0, searchable: 0 };
    const region = view({
      status: status({ state: 'indexing', counts, jobIds: [], stages: [] }),
      onPause: vi.fn(),
      onOpenModels,
    });
    expect(region.dataset['outcome']).toBe('waiting');
    expect(region.textContent).toContain('Clips from Goa are in');
    expect(region.textContent).toContain('The rest waits for a model to finish downloading.');
    expect(region.querySelector('.animate-spin')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'See models' }));
    expect(onOpenModels).toHaveBeenCalledOnce();
  });

  it('counts a stage waiting for its model as waiting, not failed, and names the model (UX3-IDX)', () => {
    // The owner's import: three clips in, OCR and language waiting for PP-OCR and whisper, nothing failed.
    const counts = { assets: 3, done: 0, active: 0, waiting: 3, failed: 0, searchable: 0 };
    const stage = (name: string, left: number, waitingForModel?: number) => ({
      stage: name,
      done: 3 - left,
      left,
      failed: 0,
      ...(waitingForModel ? { waitingForModel } : {}),
    });
    const waiting = status({
      state: 'indexing',
      counts,
      jobIds: [],
      stages: [
        stage('vision.shots', 0),
        stage('vision.ocr', 3, 3),
        stage('vision.embedOcr', 3),
        stage('audio.language', 3, 3),
        stage('vision.embed', 3, 3),
      ],
    });
    expect(importFailures(waiting)).toEqual({ unreadable: 0, unanalysed: 0 });
    const region = view({ status: waiting, onRetry: vi.fn() });
    expect(region.querySelector('[data-slot=import-failed]')).toBeNull();
    expect(region.textContent).not.toContain('couldn’t finish analysing');
    expect(region.querySelector('[data-slot=import-waiting]')?.textContent).toContain(
      'The rest waits for the on-screen text model, the speech model, and the search model to finish downloading.',
    );
    region.parentElement?.remove();
    const one = view({ status: { ...waiting, stages: [stage('vision.ocr', 3, 3)] } });
    expect(one.textContent).toContain('The rest waits for the on-screen text model to finish downloading.');
    one.parentElement?.remove();
    // LIB1-PROG: a description waiting alone waits for the model that describes; beside an embedding step, search's.
    expect(
      modelWaits({ ...waiting, stages: [stage('vision.embed', 0), stage('vision.describe', 3, 3)] }),
    ).toEqual(['describe']);
    expect(
      modelWaits({ ...waiting, stages: [stage('vision.embed', 3, 3), stage('vision.describe', 3, 3)] }),
    ).toEqual(['search']);
    const describing = view({ status: { ...waiting, stages: [stage('vision.describe', 3, 3)] } });
    expect(describing.textContent).toContain(
      'The rest waits for the model that describes clips to finish downloading.',
    );
  });

  it('says the originals are what it waits for when they are away', () => {
    const counts = { assets: 2, done: 0, active: 0, waiting: 2, failed: 0, searchable: 0 };
    const region = view({
      status: status({ state: 'indexing', counts, jobIds: [] }),
      waitingFor: 'originals',
    });
    expect(region.textContent).toContain('reconnect the drive or download them from iCloud');
  });
});
