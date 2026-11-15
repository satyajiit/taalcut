// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ROUTE: the refresh checks a recorded call to a tool that changed as the app's executor admits it: mended
 * where the tool mends an older caller's fields, then parsed. The make flow's recorded timeline.setTransition names
 * its clip `clipId`, which the tool mends to `clip` (timeline's clip-mend.ts, "a stored or recorded call"); checked
 * unmended, a refresh after a change to that tool's tags refused a call the app runs. A call the tool itself
 * refuses is still refused here.
 */
import { audioEditToolModule } from '@taalcut/timeline';
import { expect, it } from 'vitest';
import { checkedCalls, registryWire, type Tape } from '../scripts/refresh-offers';

const id = (n: number) => String(n).padStart(26, '0');
const TARGET = { projectId: id(8), timelineId: id(2) };

/** One stored response: a tool call streamed as the provider streams it. */
const called = (name: string, input: unknown) =>
  [
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
    },
  ]
    .map((event) => `data: ${JSON.stringify(event)}`)
    .join('\n');

const tape = (...responses: string[]): Tape => ({
  recordedAt: 'recorded',
  note: 'recorded',
  interactions: responses.map((chunk, index) => ({
    request: { method: 'POST', url: '/messages', match: `match-${index}`, headers: {}, body: null },
    response: { status: 200, headers: {}, chunks: [chunk] },
  })),
});

const wire = registryWire([audioEditToolModule()]);
const CHANGED = new Set(['audio.setVolume']);

it('admits a recorded call that names its clips the old way, as the tool does', () => {
  const old = { ...TARGET, of: { kind: 'clips', clipIds: [id(4)] }, muted: true };
  const now = { ...TARGET, of: { kind: 'clips', clips: [id(4)] }, muted: true };
  expect(
    checkedCalls(tape(called('audio_setVolume', old), called('audio_setVolume', now)), CHANGED, wire),
  ).toEqual({ valid: 2, invalid: [] });
});

it('refuses a recorded call the tool refuses, by its place on the tape', () => {
  const nobody = { ...TARGET, muted: true };
  const loud = { ...TARGET, of: { kind: 'clips', clipIds: [id(4)] }, gainDb: 400 };
  const good = { ...TARGET, of: { kind: 'sound', sound: 'music' }, muted: true };
  const result = checkedCalls(
    tape(called('audio_setVolume', nobody), called('audio_setVolume', good), called('audio_setVolume', loud)),
    CHANGED,
    wire,
  );
  expect(result).toEqual({ valid: 1, invalid: ['#0 audio.setVolume', '#2 audio.setVolume'] });
});

it('leaves a call to a tool that did not change alone', () => {
  const broken = called('audio_setVolume', { muted: 'yes' });
  expect(checkedCalls(tape(broken), new Set(['audio.move']), wire)).toEqual({ valid: 0, invalid: [] });
});
