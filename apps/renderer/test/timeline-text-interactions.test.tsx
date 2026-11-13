// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { defineError, err, newId, ok, TIMELINE_COMMANDS, type Result } from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { InlineTextEditor } from '../src/features/timeline/inline-text-editor';
import { TextTrack } from '../src/features/timeline/text-track';
import { editorFixture, mountEditorControl } from './simple-editor-support';

function mountTrack() {
  const fixture = editorFixture();
  const select = vi.fn();
  const text = fixture.model.texts[0]!;
  const model = {
    ...fixture.model,
    texts: [
      { ...text, start: 10, end: 40 },
      { ...text, trackId: 'T2', item: { ...text.item, id: newId<'TimelineItem'>() } },
    ],
  };
  const mounted = mountEditorControl(
    <TextTrack model={model} pxPerFrame={2} selectedId={null} onSelect={select} edits={fixture.edits} />,
  );
  const item = screen.getAllByRole('option')[0]!;
  item.setPointerCapture = vi.fn();
  return { ...fixture, ...mounted, item, select, model, text };
}

function pointer(target: Element, type: string, x: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

it('keeps text on additional tracks visible after overlapping timing edits', () => {
  const f = mountTrack();
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(f.container.querySelector('[data-slot=text-track]')?.getAttribute('style')).toContain('56px');
  expect(screen.getAllByRole('option')[1]!.style.top).toBe('32px');
});

it('extends either edge as one undoable timing command, including the last pointer position', () => {
  const f = mountTrack();
  pointer(f.item.querySelector('[data-trim-edge=end]')!, 'pointerdown', 80);
  pointer(f.item, 'pointermove', 100);
  expect(f.item.style.width).toBe('78px');
  expect(f.command).not.toHaveBeenCalled();
  pointer(f.item, 'pointerup', 110);
  expect(f.command).toHaveBeenLastCalledWith(TIMELINE_COMMANDS.editText, {
    itemId: f.text.item.id,
    start: { value: 10, rate: f.model.rate },
    duration: { value: 45, rate: f.model.rate },
  });
  pointer(f.item.querySelector('[data-trim-edge=start]')!, 'pointerdown', 20);
  pointer(f.item, 'pointerup', -100);
  expect(f.command).toHaveBeenLastCalledWith(TIMELINE_COMMANDS.editText, {
    itemId: f.text.item.id,
    start: { value: 0, rate: f.model.rate },
    duration: { value: 40, rate: f.model.rate },
  });
});

it('clamps a shortened text to one frame and cancels pointer loss without saving', () => {
  const f = mountTrack();
  pointer(f.item.querySelector('[data-trim-edge=end]')!, 'pointerdown', 80);
  pointer(f.item, 'pointermove', -100);
  pointer(f.item, 'pointercancel', -100);
  expect(f.command).not.toHaveBeenCalled();
  pointer(f.item.querySelector('[data-trim-edge=end]')!, 'pointerdown', 80);
  pointer(f.item, 'pointerup', -100);
  expect(f.command).toHaveBeenLastCalledWith(TIMELINE_COMMANDS.editText, {
    itemId: f.text.item.id,
    start: { value: 10, rate: f.model.rate },
    duration: { value: 1, rate: f.model.rate },
  });
});

it('double click edits in place; Escape discards the field without saving on blur', () => {
  const f = mountTrack();
  fireEvent.doubleClick(f.item);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Discard these words' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.blur(input);
  expect(f.edits.editText).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('preserves a failed edit for retry and does not duplicate a save on blur', async () => {
  const failure = defineError('timeline.test_failure', { retryable: true });
  const save = vi.fn<(words: string) => Promise<Result<unknown>>>(async () => err(failure({})));
  const close = vi.fn();
  mountEditorControl(
    <InlineTextEditor words="Old words" style={{}} paused={false} onSave={save} onClose={close} />,
  );
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'Keep my changes' } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  expect(input.value).toBe('Keep my changes');
  save.mockResolvedValueOnce(ok(null));
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});
