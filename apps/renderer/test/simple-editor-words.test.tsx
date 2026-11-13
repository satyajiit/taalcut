// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CAPTION_PRESETS,
  newId,
  RationalTime,
  SIMPLE_EDITOR_COMMANDS as N,
  type TimelineTranscript,
} from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CaptionSearch } from '../src/features/timeline/caption-search';
import { WordsPanel } from '../src/features/timeline/words-panel';
import { editorFixture, mountEditorControl } from './simple-editor-support';

const rpc = vi.hoisted(() => ({ backend: { timelines: { transcript: vi.fn() } } }));
vi.mock('../src/backend/backend', () => ({ useBackend: () => rpc.backend }));
beforeEach(() => vi.clearAllMocks());

function spoken() {
  const fixture = editorFixture();
  const { timeline, model } = fixture;
  const at = (value: number) => RationalTime.of(value, model.rate);
  const source = { start: at(12), duration: at(18) };
  const words = [0, 1].map((index) => ({
    clipId: model.clips[index]!.item.id,
    assetId: model.clips[0]!.item.media.assetId,
    segment: 0,
    word: 2,
    source,
    text: 'again',
    range: { start: at(index ? 80 : 20), duration: at(index ? 9 : 18) },
  }));
  const transcript: TimelineTranscript = { timelineId: timeline.id, revision: timeline.revision, words };
  rpc.backend.timelines.transcript.mockResolvedValue(transcript);
  return { ...fixture, transcript };
}

it('previews and removes only the selected occurrence of a duplicated spoken word', async () => {
  const f = spoken();
  mountEditorControl(<WordsPanel timeline={f.timeline} playhead={f.playhead} edits={f.edits} />);
  const words = await screen.findAllByRole('button', { name: 'again' });
  fireEvent.click(words[1]!);
  expect(words[0]!.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Preview interval' }));
  expect(f.seek).toHaveBeenLastCalledWith(80);
  expect(f.play).toHaveBeenCalledTimes(1);
  act(() => f.playhead.seek(88, 'player'));
  expect(f.pause).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Remove from video' }));
  await waitFor(() =>
    expect(f.command).toHaveBeenCalledWith(N.removeWords, {
      revision: f.timeline.revision,
      words: [f.transcript.words[1]],
    }),
  );
  expect(screen.getByText('0 words selected')).toBeTruthy();
});

it('rejects selected locked occurrences and stale transcript reads while keeping preview available during AI editing', async () => {
  const f = spoken();
  f.model.clips[1]!.item.locked = true;
  const view = mountEditorControl(<WordsPanel timeline={f.timeline} playhead={f.playhead} edits={f.edits} />);
  const words = await screen.findAllByRole('button', { name: 'again' });
  fireEvent.click(words[1]!);
  expect((screen.getByRole('button', { name: 'Remove from video' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByText('A selected scene is locked.')).toBeTruthy();
  fireEvent.click(words[1]!);
  fireEvent.click(words[0]!);
  view.rerender(
    <WordsPanel timeline={f.timeline} playhead={f.playhead} edits={{ ...f.edits, pending: true }} />,
  );
  expect((screen.getByRole('button', { name: 'Remove from video' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByRole('button', { name: 'Preview interval' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  const stale = Promise.withResolvers<TimelineTranscript>();
  rpc.backend.timelines.transcript.mockReturnValue(stale.promise);
  view.rerender(
    <WordsPanel
      timeline={{ ...f.timeline, revision: f.timeline.revision + 1 }}
      playhead={f.playhead}
      edits={f.edits}
    />,
  );
  expect((screen.getByRole('button', { name: 'Remove from video' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(f.command).not.toHaveBeenCalled();
});

function captions() {
  const f = editorFixture();
  const at = (value: number) => RationalTime.of(value, f.model.rate);
  const cues = ['A.b hello', 'Axb hello', 'a.b hello'].map((text, i) => {
    const range = { start: at(i * 30), duration: at(25) };
    return { id: newId<'CaptionCue'>(), range, edited: false, words: [{ text, range, confidence: 1 }] };
  });
  f.timeline.captions = {
    enabled: true,
    language: 'en',
    style: CAPTION_PRESETS.classic,
    styleSource: 'preset',
    cues,
  };
  return { ...f, cues };
}

it('finds literal caption text, seeks a match, and sends one-cue or all-cue replacements', () => {
  const f = captions();
  mountEditorControl(<CaptionSearch timeline={f.timeline} edits={f.edits} playhead={f.playhead} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Find' }), { target: { value: 'a.b' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Replace with' }), {
    target: { value: '$& welcome' },
  });
  expect(screen.getByRole('status').textContent).toBe('2 matching captions');
  const row = screen.getAllByRole('listitem')[1]!;
  fireEvent.click(within(row).getAllByRole('button')[0]!);
  expect(f.seek).toHaveBeenLastCalledWith(60);
  fireEvent.click(within(row).getByRole('button', { name: 'Replace' }));
  expect(f.command).toHaveBeenLastCalledWith(N.replaceCaptions, {
    find: 'a.b',
    replacement: '$& welcome',
    matchCase: false,
    cueIds: [f.cues[2]!.id],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Replace all' }));
  expect(f.command).toHaveBeenLastCalledWith(N.replaceCaptions, {
    find: 'a.b',
    replacement: '$& welcome',
    matchCase: false,
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Match case' }));
  expect(screen.getByRole('status').textContent).toBe('1 matching captions');
});

it('keeps caption search and seeking usable while replacement is paused', () => {
  const f = captions();
  mountEditorControl(
    <CaptionSearch timeline={f.timeline} edits={{ ...f.edits, pending: true }} playhead={f.playhead} />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Find' }), {
    target: { value: 'hello' },
  });
  for (const button of screen.getAllByRole('button', { name: /^Replace/ })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
  }
  fireEvent.click(within(screen.getAllByRole('listitem')[1]!).getAllByRole('button')[0]!);
  expect(f.seek).toHaveBeenLastCalledWith(30);
  expect(f.command).not.toHaveBeenCalled();
});
