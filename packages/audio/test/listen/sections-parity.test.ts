// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F5 sections against upstream's `earshot timeline` (detail normal). Without models: the 3 s window spans and
 * the Foote novelty peaks on the clips upstream recorded them for. With `TAALCUT_EAR1_MODELS` (fp16 on WebGPU): every
 * timeline clip end to end, boundaries within ±1 s; the gate is the 12 music clips, the rest are recorded.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { cli, intermediate } from '../../../../tools/earshot-parity/fixtures.mjs';
import { createListenModels } from '../../src/listen/describe/context';
import { directoryListenFiles } from '../../src/listen/models/files';
import { createListenSessions } from '../../src/listen/models/sessions';
import { listenSections, sectionSpans, toSoundSection } from '../../src/listen/timeline/sections';
import { sectionLabel } from '../../src/listen/timeline/sections-label';
import { noveltyBounds } from '../../src/listen/timeline/sections-novelty';
import { MODELS, timelineMonoOf } from './models-helpers';

interface Recorded {
  readonly win: number;
  readonly hop: number;
  readonly spans: [number, number][];
  readonly novelty: [number, number][];
}

const recorded = intermediate<Record<string, Recorded>>('sections');
const timeline = cli<{ duration: number; sections: { start: number; end: number; label: string }[] }>(
  'timeline',
);

describe('sections without models', () => {
  it.each(Object.keys(recorded))('%s: the same windows and hop', (id) => {
    const row = recorded[id] as Recorded;
    const duration = timelineMonoOf(id).length / 48_000;
    const hop = Math.max(2, Math.round(((duration - 3) / 31) * 100) / 100);
    expect(hop).toBeCloseTo(row.hop, 6);
    expect(sectionSpans(duration, row.win, hop)).toEqual(row.spans);
  });

  it.each(Object.keys(recorded))('%s: the same novelty peaks (time exact, z ±0.2)', (id) => {
    const row = recorded[id] as Recorded;
    const ours = noveltyBounds(timelineMonoOf(id));
    expect(ours.map(([t]) => t)).toEqual(row.novelty.map(([t]) => t));
    ours.forEach(([, z], i) =>
      expect(Math.abs(z - (row.novelty[i]?.[1] ?? Number.NaN))).toBeLessThanOrEqual(0.2),
    );
  });

  it('labels as upstream words them', () => {
    const tag = (term: string, z: number) => ({ term, category: 'music_genre' as const, z, cosine: 0.2 });
    const base = { mood: [tag('sad and melancholic music', 2.6)], instruments: [tag('a music box', 1.6)] };
    const music = {
      genre: [tag('chiptune video game music', 2.4)],
      ...base,
      ambience: [tag('a crackling fire', 1)],
      voice: [tag('a man speaking', 0)],
      lufs: -20,
      silent: false,
      presence: { music: 0.6, speech: 0.4, silence: 0 },
      audioSet: [
        { label: 'Music', score: 0.6 },
        { label: 'Organ', score: 0.4 },
      ],
    };
    expect(sectionLabel(music)).toBe(
      'chiptune video game music?, music box, sad and melancholic | also: organ (AST) | voice: man speaking',
    );
    expect(sectionLabel({ ...music, lufs: -60 })).toBe('near silence');
    expect(sectionLabel({ ...music, silent: true })).toBe('digital silence');
  });
});

describe.skipIf(!MODELS)('sections end to end (fp16)', () => {
  const sessions = createListenSessions({ files: directoryListenFiles(MODELS ?? '', 'fp16') });
  const models = createListenModels(sessions, directoryListenFiles(MODELS ?? '', 'fp16'));
  afterAll(() => sessions.release());

  it('boundaries within ±1 s of upstream on every music clip', async () => {
    const lines: string[] = [];
    let music = 0;
    let musicOk = 0;
    let other = 0;
    let otherOk = 0;
    for (const [id, run] of Object.entries(timeline)) {
      const result = await listenSections(models, timelineMonoOf(id));
      expect(result.ok, id).toBe(true);
      if (!result.ok) continue;
      const ours = result.value.sections;
      const theirs = run.result.sections;
      const same =
        ours.length === theirs.length &&
        ours.every(
          (s, i) =>
            Math.abs(s.start - (theirs[i]?.start ?? -9)) <= 1 &&
            Math.abs(s.end - (theirs[i]?.end ?? -9)) <= 1,
        );
      for (const section of ours) toSoundSection(section);
      if (id.startsWith('music-')) [music, musicOk] = [music + 1, musicOk + Number(same)];
      else [other, otherOk] = [other + 1, otherOk + Number(same)];
      if (!same) {
        lines.push(
          `${id}: ours ${ours.map((s) => `${s.start}-${s.end}`).join(' ')}; upstream ${theirs.map((s) => `${s.start}-${s.end}`).join(' ')}`,
        );
      }
    }
    console.warn(
      `sections: music ${musicOk}/${music} within ±1 s, others ${otherOk}/${other}\n${lines.join('\n')}`,
    );
    expect(music).toBeGreaterThanOrEqual(10);
    expect(musicOk).toBe(music);
  }, 600_000);
});
