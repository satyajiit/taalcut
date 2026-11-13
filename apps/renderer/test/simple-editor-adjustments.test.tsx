// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, ok, RationalTime, SIMPLE_EDITOR_COMMANDS as N } from '@taalcut/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BulkControls } from '../src/features/timeline/bulk-controls';
import { MoreActions } from '../src/features/timeline/more-actions';
import { editorFixture, mountEditorControl } from './simple-editor-support';

it('adjusts the complete selected set and copies only checked settings from the chosen source', () => {
  const f = editorFixture();
  const ids = f.model.clips.slice(0, 2).map((clip) => clip.item.id);
  mountEditorControl(<BulkControls ids={ids} model={f.model} edits={f.edits} />);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Exposure' }), { target: { value: '0.7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply color' }));
  expect(f.command).toHaveBeenLastCalledWith(N.adjustClips, { clipIds: ids, color: { exposure: 0.7 } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Sound level (dB)' }), {
    target: { value: '-12' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply sound' }));
  expect(f.command).toHaveBeenLastCalledWith(N.adjustClips, { clipIds: ids, sound: { gainDb: -12 } });
  fireEvent.click(screen.getByRole('button', { name: 'Show whole image' }));
  expect(f.command).toHaveBeenLastCalledWith(N.adjustClips, {
    clipIds: ids,
    framing: { fit: 'contain', reframe: null },
  });
  const source = f.model.clips[3]!.item.id;
  fireEvent.change(screen.getByRole('combobox', { name: 'Copy from' }), { target: { value: source } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sound' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy settings' }));
  expect(f.command).toHaveBeenLastCalledWith(N.copyClipSettings, {
    sourceClipId: source,
    clipIds: ids,
    settings: ['color', 'framing'],
  });
});

it.each(['locked', 'paused', 'empty'] as const)(
  'blocks the whole bulk edit when selection is %s',
  (reason) => {
    const f = editorFixture();
    const ids = reason === 'empty' ? [] : f.model.clips.slice(0, 2).map((clip) => clip.item.id);
    if (reason === 'locked') f.model.clips[1]!.item.locked = true;
    mountEditorControl(
      <BulkControls ids={ids} model={f.model} edits={{ ...f.edits, pending: reason === 'paused' }} />,
    );
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(f.command).not.toHaveBeenCalled();
  },
);

it('does not offer source-sound changes for a selection containing a photograph', () => {
  const f = editorFixture();
  f.model.clips[1]!.item.media = { kind: 'image', assetId: f.model.clips[1]!.item.media.assetId };
  const ids = f.model.clips.slice(0, 2).map((clip) => clip.item.id);
  mountEditorControl(<BulkControls ids={ids} model={f.model} edits={f.edits} />);
  const sound = screen.getByRole('button', { name: 'Apply sound' }) as HTMLButtonElement;
  expect(sound.disabled).toBe(true);
  expect(sound.title).toBe('Photos have no source sound');
  expect((screen.getByRole('button', { name: 'Apply color' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(sound);
  expect(f.command).not.toHaveBeenCalled();
});

it('makes an independent size copy and opens only the committed copy from its receipt', async () => {
  const f = editorFixture();
  const newTimelineId = newId<'Timeline'>();
  const onVideo = vi.fn();
  f.command.mockResolvedValueOnce(
    ok({
      id: newId<'Command'>(),
      name: N.makeSize,
      projectId: f.timeline.projectId,
      result: { timelineId: newTimelineId, revision: 1, affectedItemIds: [] },
      deduplicated: false,
      sequence: 3,
      undoable: true,
    }),
  );
  mountEditorControl(
    <MoreActions
      clip={f.model.clips[0]}
      model={f.model}
      playhead={f.playhead}
      edits={f.edits}
      onVideo={onVideo}
      onCover={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '1:1' }));
  expect(f.command).toHaveBeenCalledWith(N.makeSize, { aspect: '1:1' });
  expect(onVideo).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Open the new video' }));
  expect(onVideo).toHaveBeenCalledWith(newTimelineId);
  expect(f.timeline.id).not.toBe(newTimelineId);
});

it('freezes the displayed frame at two seconds by default, then edits an existing hold without recapturing it', () => {
  const f = editorFixture();
  const clip = f.model.clips[0]!;
  f.playhead.seek(14);
  const props = {
    clip,
    model: f.model,
    playhead: f.playhead,
    edits: f.edits,
    onVideo: vi.fn(),
    onCover: vi.fn(),
  };
  const view = mountEditorControl(<MoreActions {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Freeze this moment' }));
  expect(f.command).toHaveBeenLastCalledWith(N.freezeFrame, {
    clipId: clip.item.id,
    at: RationalTime.of(14, f.model.rate),
    duration: RationalTime.fromSeconds(2, f.model.rate),
  });
  clip.item.holdFrame = RationalTime.of(19, f.model.rate);
  view.rerender(<MoreActions {...props} />);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Hold length (seconds)' }), {
    target: { value: '3.5' },
  });
  f.playhead.seek(120);
  fireEvent.click(screen.getByRole('button', { name: 'Change hold length' }));
  expect(f.command).toHaveBeenLastCalledWith(N.setHoldDuration, {
    clipId: clip.item.id,
    duration: RationalTime.fromSeconds(3.5, f.model.rate),
  });
});

it('keeps cover preparation available while AI ownership disables persistent video changes', async () => {
  const f = editorFixture();
  const onCover = vi.fn();
  mountEditorControl(
    <MoreActions
      clip={f.model.clips[0]}
      model={f.model}
      playhead={f.playhead}
      edits={{ ...f.edits, pending: true }}
      onVideo={vi.fn()}
      onCover={onCover}
    />,
  );
  for (const name of ['9:16', '4:5', '1:1', '16:9', 'Freeze this moment']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Choose cover' }));
  await waitFor(() => expect(onCover).toHaveBeenCalledTimes(1));
  expect(f.command).not.toHaveBeenCalled();
});
