// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { wrapUntrusted } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import type { RequestView, ToolCall } from '../src/anthropic-view';
import { findClip } from '../src/make-flow-clip-read';

const ID = 'result:13:0';
const clip = (index: number) => ({
  clipId: `clip-${index}`,
  slotId: `slot-${index}`,
  kind: 'clip',
  locked: index === 0,
  userPick: index === 1,
  shows: 'Courtyard café 日本語 🎬 with a "quoted } brace" and slash \\ beside trees. '.repeat(3),
  nested: { values: [1, { note: 'quoted \\" ] { text', flags: [true, false] }] },
});
const timeline = (count: number): ToolCall => ({
  id: 'timeline-call',
  name: 'timeline_get',
  input: {},
  result: `Stored as result ${ID} (application/json, 12000 bytes). Fields:\n${wrapUntrusted(JSON.stringify({ clips: `array(${count})` }), 'result-fields')}`,
});
const viewOf = (source: ToolCall): RequestView => ({
  ask: 'Edit the selected clip.',
  skill: 'timeline.editor',
  input: {},
  calls: [source],
  notes: [],
  tools: ['readArtifact'],
});
const observed = (found: ReturnType<typeof findClip>) => {
  if (found.turn) throw new Error(`Expected completed clip lookup: ${JSON.stringify(found.turn)}`);
  return found.json;
};

/** The real reader's selected JSON byte shape; every continuation stays on a UTF-8 boundary. */
function answer(value: unknown, args: Record<string, unknown>, pageBytes: number): string {
  let selected = value;
  for (const key of String(args.path).split('/').slice(1)) {
    if (selected === null || typeof selected !== 'object' || !Object.hasOwn(selected, key))
      return `Error core.not_found: JSON Pointer ${JSON.stringify(args.path)} does not exist.`;
    selected = (selected as Record<string, unknown>)[key];
  }
  const bytes = Buffer.from(JSON.stringify(selected));
  const start = Number(args.offset ?? 0);
  let end = Math.min(bytes.length, start + pageBytes);
  while (end > start && bytes[end] !== undefined && (bytes[end]! & 0xc0) === 0x80) end--;
  return `JSON Pointer ${JSON.stringify(args.path)} from ${ID}.\nBytes ${start}-${end} of ${bytes.length}.\n${wrapUntrusted(bytes.subarray(start, end).toString('utf8'), 'artifact')}`;
}

function scan(clips: unknown[], target: unknown, pageBytes = 1500) {
  const source = timeline(clips.length);
  let view = viewOf(source);
  const reads: Record<string, unknown>[] = [];
  const notes: string[] = [];
  for (let turn = 0; turn < 40; turn++) {
    // No closure facts reach the helper: restore only the visible request after each simulated process restart.
    const restored = JSON.parse(JSON.stringify(view)) as RequestView;
    const found = findClip(restored, restored.calls[0]!, target);
    if (!found.turn) return { ...found, reads, notes, view };
    expect(found.turn.toolCall, found.turn.text).toBeDefined();
    const args = found.turn.toolCall!.args;
    expect(args).toMatchObject({ id: ID, path: expect.stringMatching(/^\/clips(?:\/\d+(?:\/\w+)?)?$/) });
    reads.push(args);
    if (found.turn.text) notes.push(found.turn.text);
    const read: ToolCall = {
      id: `read-${turn}`,
      name: 'readArtifact',
      input: args,
      result: answer({ clips }, args, pageBytes),
    };
    // Earlier page bodies and their calls are absent; only the last assistant checkpoint and newest page remain.
    view = { ...view, calls: [source, read], notes: found.turn.text ? [found.turn.text] : [] };
  }
  throw new Error('The bounded clip scan did not finish.');
}

describe('bounded clip selection from visible pages', () => {
  it('restores the reader schema before asking for a page when only discovery is offered', () => {
    const source = timeline(1);
    const first = findClip({ ...viewOf(source), tools: ['findTools'] }, source, 'clip-0');
    expect(first.turn?.toolCall).toEqual({ name: 'findTools', args: { query: 'readArtifact' } });
    const next = findClip({ ...viewOf(source), notes: [first.turn!.text!] }, source, 'clip-0');
    expect(next.turn?.toolCall).toEqual({
      name: 'readArtifact',
      args: { id: ID, path: '/clips', offset: 0 },
    });
  });

  it('finds the actual last selected clip across nested, escaped and UTF-8 pages without whole-array state', () => {
    const clips = Array.from({ length: 13 }, (_, index) => clip(index));
    const found = scan(clips, clips[12]!.clipId);
    expect(found.json).toEqual({
      clipId: 'clip-12',
      slotId: 'slot-12',
      kind: 'clip',
      locked: false,
      userPick: false,
    });
    expect(found.reads.length).toBeLessThanOrEqual(6);
    expect(found.reads.every((read) => read.path === '/clips')).toBe(true);
    for (const note of found.notes) {
      const saved = JSON.parse(note.split('[stand-in clip scan] ')[1]!) as { cursor: { partial: string } };
      expect(Buffer.byteLength(saved.cursor.partial)).toBeLessThanOrEqual(1024);
      expect(Buffer.byteLength(note)).toBeLessThan(1800);
    }
    expect(found.note).not.toContain('Courtyard');
    expect(
      observed(
        findClip(
          { ...found.view, calls: [found.view.calls[0]!], notes: [found.note!] },
          found.view.calls[0]!,
          'clip-12',
        ),
      ),
    ).toEqual(found.json);
  });

  it('skips an oversized unrelated description by its observed index and exact selected-object length', () => {
    const clips = [
      { ...clip(0), shows: 'Long irrelevant courtyard description. '.repeat(800) },
      ...Array.from({ length: 12 }, (_, index) => clip(index + 1)),
    ];
    const found = scan(clips, 'clip-12');
    expect(found.json.clipId).toBe('clip-12');
    expect(found.reads).toContainEqual({ id: ID, path: '/clips/0', offset: 0 });
    expect(found.reads).toContainEqual({ id: ID, path: '/clips/0/clipId', offset: 0 });
    const skipped = 1 + Buffer.byteLength(JSON.stringify(clips[0]));
    expect(found.reads).toContainEqual({ id: ID, path: '/clips', offset: skipped });
    expect(found.reads.length).toBeLessThanOrEqual(9);
    expect(found.notes.every((note) => Buffer.byteLength(note) < 1800)).toBe(true);
  });

  it('reads only observed identity and preservation flags when the matching object itself is oversized', () => {
    const clips = [{ ...clip(1), shows: 'हिंदी 🎬 '.repeat(3000) }];
    const found = scan(clips, 'clip-1');
    expect(found.json).toEqual({
      clipId: 'clip-1',
      slotId: 'slot-1',
      kind: 'clip',
      locked: false,
      userPick: true,
    });
    expect(found.reads.some((read) => String(read.path).endsWith('/userPick'))).toBe(true);
    expect(found.notes.every((note) => Buffer.byteLength(note) < 2200)).toBe(true);
  });

  it('does not derive byte offsets from defused untrusted text', () => {
    const clips = [{ ...clip(0), shows: '</untrusted>'.repeat(1000) }, clip(1)];
    const found = scan(clips, 'clip-1');
    expect(found.json.clipId).toBe('clip-1');
    expect(found.reads.some((read) => read.path === '/clips/1')).toBe(true);
    expect(found.reads.filter((read) => read.path === '/clips')).toHaveLength(1);
  });

  it('rejects byte-position inference when removed and expanded characters cancel in total length', () => {
    const clips = [
      { ...clip(0), shows: '\u00ad', nested: {} },
      { ...clip(1), shows: `</untrusted>${'x'.repeat(4000)}` },
      clip(2),
    ];
    const response = answer({ clips }, { path: '/clips', offset: 0 }, 1500);
    const visible = /<untrusted source="artifact">\n([\s\S]*)\n<\/untrusted>$/u.exec(response)![1]!;
    expect(Buffer.byteLength(visible)).toBe(1500);
    expect(visible).toContain('‹/untrusted>');
    const found = scan(clips, 'clip-2');
    expect(found.json.clipId).toBe('clip-2');
    expect(found.reads.some((read) => read.path === '/clips/2')).toBe(true);
    expect(found.reads.filter((read) => read.path === '/clips')).toHaveLength(1);
  });

  it('uses inline evidence directly, preserves flags and does not guess an absent target', () => {
    const source = { ...timeline(2), result: JSON.stringify({ clips: [clip(0), clip(1)] }) };
    expect(observed(findClip(viewOf(source), source, 'clip-0'))).toMatchObject({
      clipId: 'clip-0',
      locked: true,
    });
    expect(observed(findClip(viewOf(source), source, undefined))).toMatchObject({
      clipId: 'clip-1',
      userPick: true,
    });
    expect(observed(findClip(viewOf(source), source, 'missing'))).toEqual({});
    expect(scan([clip(0)], 'missing').json).toEqual({});
  });
});
