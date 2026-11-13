// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { newId, RationalTime, unwrap, type AuthoredProgram } from '@taalcut/core';
import { createAuthoredTimeline, replaceAuthoredProgram } from '../src/assembly/authored';
import { trimStart } from '../src/model/clip-edit';
import { checkEdited } from '../src/model/validate';
import { otioExporter } from '../src/interchange/otio/otio-exporter';

const rate = { num: 60, den: 1 };
const time = (seconds: number) => RationalTime.of(seconds * 60, rate);
function fixture() {
  const program: AuthoredProgram = {
    id: newId<'AuthoredProgram'>(),
    hash: 'a'.repeat(64),
    version: 1,
    entry: 'index.html',
    files: [{ path: 'index.html', sha256: 'b'.repeat(64), bytes: 30 }],
    canvas: { width: 1920, height: 1080, rate },
    duration: time(30),
    assetIds: [],
    chapters: [
      { id: 'hook', name: 'Opening', start: time(0), duration: time(10) },
      { id: 'demo', name: 'Demo', start: time(10), duration: time(20) },
    ],
  };
  return {
    program,
    timeline: unwrap(
      createAuthoredTimeline({ projectId: newId<'Project'>(), program, name: 'Launch', now: 123 }),
    ),
  };
}

describe('authored timeline', () => {
  it('creates one continuous native program with visible chapter markers and no template dependency', () => {
    const { timeline } = fixture();
    expect(timeline.template).toBeNull();
    expect(timeline.music.path).toBe('none');
    expect(timeline.tracks[0]?.items).toHaveLength(1);
    expect(timeline.tracks[0]?.items[0]).toMatchObject({ type: 'program', duration: { value: 1800 } });
    expect(timeline.markers.map((marker) => marker.label)).toEqual(['Opening', 'Demo']);
  });

  it('replaces the source version and reference together without altering host revision or old snapshots', () => {
    const { timeline, program } = fixture();
    const updated = unwrap(
      replaceAuthoredProgram(timeline, { ...program, version: 2, hash: 'c'.repeat(64) }),
    );
    expect(updated.revision).toBe(1);
    expect(updated.tracks[0]?.items[0]).toMatchObject({ program: { hash: 'c'.repeat(64) } });
    expect(updated.authoredPrograms).toHaveLength(1);
    expect(timeline.authoredPrograms?.[0]?.hash).toBe('a'.repeat(64));
    expect(replaceAuthoredProgram(timeline, { ...program, id: newId<'AuthoredProgram'>() }).ok).toBe(false);
  });

  it('retains source time on a trim and rejects ranges outside the program', () => {
    const { timeline } = fixture();
    const track = timeline.tracks[0]!;
    if (track.kind !== 'video' || track.items[0]?.type !== 'program') throw new Error('Expected program');
    const item = trimStart(track.items[0], 300, rate);
    expect(item).toMatchObject({ sourceStart: { value: 300 }, duration: { value: 1500 } });
    expect(
      checkEdited({ ...timeline, tracks: [{ ...track, items: [{ ...item, duration: time(30) }] }] }).ok,
    ).toBe(false);
  });

  it('refuses lossy interchange rather than dropping the program', () => {
    expect(otioExporter.write(fixture().timeline, { media: new Map(), pathStyle: 'fileUrl' }).ok).toBe(false);
  });
});
