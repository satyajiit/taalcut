// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** listen-mood's manifest (EAR1-B3): 30 or more CC0 tracks with vocabulary moods; any other licence is refused. */
import { describe, expect, it } from 'vitest';
import { moodManifestSchema, MOOD_TERMS } from './manifest';
import { MOOD_BAR } from './run';

describe('listen-mood manifest', () => {
  const track = (i: number, licence = 'CC0-1.0') => ({
    id: `t${i}`,
    title: `Track ${i}`,
    url: `https://example.org/t${i}.mp3`,
    sha256: 'a'.repeat(64),
    bytes: 100,
    licence,
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source: `https://example.org/t${i}`,
    mood: MOOD_TERMS[i % MOOD_TERMS.length],
    labelledBy: 'the publisher',
  });

  it('reads its bar from ci-paths.json', () => {
    expect(MOOD_BAR.top3MoodRate).toBe(0.7);
  });

  it('takes 30 CC0 tracks with vocabulary moods and refuses any other licence', () => {
    const tracks = Array.from({ length: 30 }, (_, i) => track(i));
    expect(moodManifestSchema.safeParse({ version: 1, tracks }).success).toBe(true);
    const nc = [...tracks.slice(1), track(0, 'CC-BY-NC-4.0')];
    expect(moodManifestSchema.safeParse({ version: 1, tracks: nc }).success).toBe(false);
    expect(moodManifestSchema.safeParse({ version: 1, tracks: tracks.slice(5) }).success).toBe(false);
  });
});
