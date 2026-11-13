// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ClipTrimControls } from '../src/features/timeline/clip-trim-controls';
import { editorFixture, mountEditorControl } from './simple-editor-support';

it('trims in seconds and preserves the amount when exact frames are revealed', () => {
  const f = editorFixture();
  const clip = f.model.clips[0]!;
  const rate = f.model.rate.num / f.model.rate.den;
  mountEditorControl(<ClipTrimControls clip={clip} model={f.model} edits={f.edits} />);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Seconds per adjustment' }), {
    target: { value: '0.5' },
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove 0.5 s' })[0]!);
  expect(f.edits.trim).toHaveBeenLastCalledWith(clip.item.id, 'start', -Math.round(rate / 2));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Adjust by exact frames' }));
  expect((screen.getByRole('spinbutton', { name: 'Frames per adjustment' }) as HTMLInputElement).value).toBe(
    String(Math.round(rate / 2)),
  );
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Frames per adjustment' }), {
    target: { value: '1' },
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Restore 1 frame' })[1]!);
  expect(f.edits.trim).toHaveBeenLastCalledWith(clip.item.id, 'end', 1);
});
