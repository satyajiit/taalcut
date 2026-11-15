// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { SIMPLE_EDITOR_COMMANDS as N } from '@taalcut/core';
import { fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BulkControls } from '../src/features/timeline/bulk-controls';
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

// MORE1: the size copy, the held moment and the cover moved to the More gallery's tiles (more-dialogs.test.tsx,
// more-gallery.test.tsx), with the same commands.
