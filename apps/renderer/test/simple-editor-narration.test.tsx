// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ConflictError, err, newId, RationalTime, SIMPLE_EDITOR_COMMANDS as N } from '@taalcut/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NarrationPanel } from '../src/features/timeline/narration-panel';
import type { useNarrationRecorder } from '../src/features/voice/use-narration-recorder';
import { editorFixture, mountEditorControl } from './simple-editor-support';

type Recorder = ReturnType<typeof useNarrationRecorder>;
const hook = vi.hoisted(() => ({ use: vi.fn() }));
vi.mock('../src/features/voice/use-narration-recorder', () => ({ useNarrationRecorder: hook.use }));
const take = { captureKey: newId<'VoiceCapture'>(), durationMs: 2000, url: 'blob:recorded' };
function recorder(patch: Partial<Recorder> = {}): Recorder {
  return {
    phase: 'idle',
    count: 3,
    level: 0,
    elapsed: 0,
    error: null,
    permission: null,
    take: null,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
    ...patch,
  };
}
beforeEach(() => vi.clearAllMocks());

it('requires Record before requesting capture and places the saved take at that captured playhead', async () => {
  const f = editorFixture();
  const capture = recorder();
  hook.use.mockReturnValue(capture);
  f.playhead.seek(30);
  const view = mountEditorControl(
    <NarrationPanel timeline={f.timeline} playhead={f.playhead} edits={f.edits} />,
  );
  expect(capture.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Record voice' }));
  expect(capture.start).toHaveBeenCalledWith(
    ((f.model.total - 30) * f.model.rate.den * 1000) / f.model.rate.num,
  );
  expect(f.pause).toHaveBeenCalledTimes(1);
  hook.use.mockReturnValue({ ...capture, phase: 'ready', take });
  f.playhead.seek(100);
  view.rerender(<NarrationPanel timeline={f.timeline} playhead={f.playhead} edits={f.edits} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use recording' }));
  await waitFor(() => expect(capture.reset).toHaveBeenCalledTimes(1));
  expect(f.command).toHaveBeenCalledWith(N.addNarration, {
    captureKey: take.captureKey,
    at: RationalTime.of(30, f.model.rate),
    revision: f.timeline.revision,
  });
});

it('keeps a take across a video revision and makes original-position reuse an explicit choice', async () => {
  const f = editorFixture();
  const capture = recorder();
  hook.use.mockReturnValue(capture);
  f.playhead.seek(40);
  const view = mountEditorControl(
    <NarrationPanel timeline={f.timeline} playhead={f.playhead} edits={f.edits} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Record voice' }));
  hook.use.mockReturnValue({ ...capture, phase: 'ready', take });
  const next = { ...f.timeline, revision: f.timeline.revision + 1 };
  view.rerender(
    <NarrationPanel timeline={next} playhead={f.playhead} edits={{ ...f.edits, pending: true }} />,
  );
  expect(screen.getByRole('status').textContent).toContain('Your take is kept');
  expect(
    (screen.getByRole('button', { name: 'Use at original position' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((screen.getByRole('button', { name: 'Retake' }) as HTMLButtonElement).disabled).toBe(true);
  expect(f.command).not.toHaveBeenCalled();
  view.rerender(<NarrationPanel timeline={next} playhead={f.playhead} edits={f.edits} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use at original position' }));
  await waitFor(() =>
    expect(f.command).toHaveBeenCalledWith(N.addNarration, {
      captureKey: take.captureKey,
      at: RationalTime.of(40, f.model.rate),
      revision: next.revision,
    }),
  );
});

it('retains a take on a rejected placement; only Retake discards it', async () => {
  const f = editorFixture();
  const capture = recorder({ phase: 'ready', take });
  hook.use.mockReturnValue(capture);
  f.command.mockResolvedValue(err(ConflictError({ entity: 'timeline', id: f.timeline.id })));
  mountEditorControl(<NarrationPanel timeline={f.timeline} playhead={f.playhead} edits={f.edits} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use recording' }));
  await waitFor(() => expect(f.command).toHaveBeenCalledTimes(1));
  expect(capture.reset).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Play recorded take').getAttribute('src')).toBe(take.url);
  fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
  expect(capture.reset).toHaveBeenCalledTimes(1);
});

it('explains denied permission and disables new recording while edits are paused', () => {
  const f = editorFixture();
  const capture = recorder({ permission: 'denied' });
  hook.use.mockReturnValue(capture);
  mountEditorControl(
    <NarrationPanel timeline={f.timeline} playhead={f.playhead} edits={{ ...f.edits, pending: true }} />,
  );
  expect(screen.getByRole('status').textContent).toContain('Allow microphone access');
  const record = screen.getByRole('button', { name: 'Record voice' }) as HTMLButtonElement;
  expect(record.disabled).toBe(true);
  fireEvent.click(record);
  expect(capture.start).not.toHaveBeenCalled();
});
