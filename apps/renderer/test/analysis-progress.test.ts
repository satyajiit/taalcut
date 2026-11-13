// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-PROG: a clip's analysis grouped by what it gives the person, what the clip is good for already, Analyse
// again's stale parts, and roughly how long is left from this Mac's own step lengths and the jobs' reports.
import type { AssetDetail } from '@taalcut/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';
import {
  roundedLeftMs,
  stageLeftMs,
  timeLeftMs,
} from '../src/features/library/clip/progress/analysis-estimate';
import {
  analysisGroups,
  groupFraction,
  groupOf,
  readinessOf,
} from '../src/features/library/clip/progress/analysis-groups';
import { nowLine, readinessHeading } from '../src/features/library/clip/progress/analysis-words';
import { analysing, analysisStarted } from '../src/features/library/clip/progress/use-reanalyse';
import { activateLocale, i18n } from '../src/i18n/i18n';

beforeAll(() => activateLocale('en'));

type Stage = AssetDetail['stages'][number];
const NOW = 1_760_000_000_000;
/** A copy to play: the original, small enough to be its own (the fixture has none). */
const PLAYBACK: AssetDetail['playback'] = {
  source: 'original',
  width: 1080,
  height: 1920,
  duration: { value: 183, rate: { num: 30, den: 1 } },
  frameRate: { num: 30, den: 1 },
};

/** The library's pipeline (DEFAULT_STAGE_ORDER), every stage in `state` unless `rows` says otherwise. */
function stages(rows: Record<string, Partial<Stage>> = {}, state: Stage['state'] = 'done'): Stage[] {
  return [
    'library.hash',
    'media.normalise',
    'media.thumbnail',
    'vision.shots',
    'vision.analyse',
    'vision.ocr',
    'vision.embed',
    'vision.embedOcr',
    'audio.language',
    'audio.transcript',
    'vision.embedText',
    'media.proxy',
    'media.filmstrip',
    'media.previews',
    'vision.describe',
  ].map((stage) => ({ stage, state, ...rows[stage] }));
}

const fresh = (stageRows: Stage[], index: Partial<AssetDetail['asset']['index']> = {}): AssetDetail => ({
  ...CLIP_FIXTURE,
  asset: {
    ...CLIP_FIXTURE.asset,
    description: null,
    language: null,
    index: { ...CLIP_FIXTURE.asset.index, state: 'indexing', searchableAt: null, ...index },
  },
  shots: [],
  transcript: null,
  playback: null,
  filmstrip: null,
  waveform: null,
  stages: stageRows,
});

const states = (detail: AssetDetail) =>
  Object.fromEntries(analysisGroups(detail).map((group) => [group.key, group.state]));

describe('the groups', () => {
  it('put each step under what it gives, and a step they don’t know by its package', () => {
    expect(
      [
        'media.proxy',
        'vision.shots',
        'vision.ocr',
        'audio.transcript',
        'vision.embedText',
        'vision.describe',
      ].map(groupOf),
    ).toEqual(['play', 'shots', 'picture', 'sound', 'search', 'describe']);
    expect(
      ['audio.mood', 'media.loudness', 'vision.embedFaces', 'vision.faces', 'library.place'].map(groupOf),
    ).toEqual(['sound', 'play', 'search', 'picture', 'play']);
  });

  it('say done, now, next and later in reading order', () => {
    const detail = fresh(
      stages(
        {
          'vision.embed': { state: 'running' },
          'vision.embedOcr': { state: 'queued' },
          'audio.language': { state: 'waiting' },
          'audio.transcript': { state: 'waiting' },
          'vision.embedText': { state: 'waiting' },
          'vision.describe': { state: 'waiting' },
        },
        'done',
      ),
    );
    expect(states(detail)).toEqual({
      play: 'done',
      shots: 'done',
      picture: 'done',
      sound: 'later',
      search: 'now',
      describe: 'later',
    });
    const readiness = readinessOf(detail, analysisGroups(detail));
    expect(readiness).toMatchObject({ overall: 'running', canPlay: false, canSearch: false, again: false });
    expect(readiness.now?.key).toBe('search');
    expect(nowLine(i18n, readiness)).toBe('Taalcut is getting it ready for search.');
  });

  it('name what holds a group, a skip’s reason, and a failure first', () => {
    const held = fresh(
      stages({
        'audio.language': { state: 'waiting', reasonKey: 'library.stage.modelMissing' },
        'audio.transcript': { state: 'waiting' },
        'vision.describe': { state: 'waiting', reasonKey: 'library.stage.modelMissing' },
        'vision.shots': { state: 'skipped', reasonKey: 'indexing.skip.noShots' },
      }),
    );
    const groups = analysisGroups(held);
    expect(states(held)).toMatchObject({ sound: 'model', describe: 'model', shots: 'skipped' });
    expect(groups.find((group) => group.key === 'shots')?.reasonKey).toBe('indexing.skip.noShots');
    expect(readinessOf(held, groups)).toMatchObject({ overall: 'held', heldForModel: true, now: null });

    const failed = fresh(
      stages({ 'vision.shots': { state: 'failed' }, 'vision.analyse': { state: 'running' } }),
    );
    expect(states(failed)).toMatchObject({ shots: 'failed', picture: 'now' });
    // Skipped with no reason behind a failed step: not reached, not "not needed".
    const stopped = fresh(
      stages({ 'vision.shots': { state: 'failed' } }, 'skipped').map((stage) =>
        stage.stage === 'library.hash' ? { ...stage, state: 'done' as const } : stage,
      ),
    );
    expect(states(stopped)).toMatchObject({ play: 'done', shots: 'failed', sound: 'stopped' });
    expect(readinessOf(failed, analysisGroups(failed)).overall).toBe('failed');
  });

  it('lead with what the clip is good for already', () => {
    const steps = stages({ 'vision.describe': { state: 'running' } });
    const heading = (detail: AssetDetail) =>
      readinessHeading(i18n, readinessOf(detail, analysisGroups(detail)));
    expect(heading(fresh(steps))).toBe('Taalcut is still looking at this clip');
    expect(heading(fresh(steps, { searchableAt: NOW }))).toBe('You can search this clip now');
    const playable = { ...fresh(steps, { searchableAt: NOW }), playback: PLAYBACK };
    expect(heading(playable)).toBe('You can play and search this clip now');
    expect(
      heading({
        ...playable,
        asset: { ...playable.asset, index: { ...playable.asset.index, searchableAt: null } },
      }),
    ).toBe('You can play this clip now');
    expect(readinessOf(fresh(stages()), analysisGroups(fresh(stages()))).overall).toBe('complete');
  });
});

describe('Analyse again', () => {
  const again = (rows: Record<string, Partial<Stage>>) => ({
    ...CLIP_FIXTURE,
    asset: {
      ...CLIP_FIXTURE.asset,
      index: { ...CLIP_FIXTURE.asset.index, state: 'indexing' as const, searchableAt: null },
    },
    playback: PLAYBACK,
    stages: stages(rows, 'waiting'),
  });

  it('marks the parts whose old results show as stale, and every part still to do as being redone', () => {
    const detail = again({ 'library.hash': { state: 'done' }, 'media.normalise': { state: 'running' } });
    const groups = analysisGroups(detail);
    const by = (key: string) => groups.find((group) => group.key === key)!;
    // The fixture has shots, their analysis, a transcript, a description and a copy to play.
    for (const key of ['play', 'shots', 'picture', 'sound', 'describe']) expect(by(key).stale).toBe(true);
    // Search's vectors show nowhere, so it is redone without being stale.
    expect(by('search')).toMatchObject({ stale: false, redoing: true });
    expect(readinessHeading(i18n, readinessOf(detail, groups))).toBe('Taalcut is analysing this clip again');
  });

  it('doesn’t take a first analysis for one: a copy made while its waveform is still to come', () => {
    const detail = {
      ...fresh(stages({ 'media.previews': { state: 'running' }, 'vision.describe': { state: 'waiting' } })),
      playback: PLAYBACK,
    };
    const groups = analysisGroups(detail);
    expect(groups.some((group) => group.stale || group.redoing)).toBe(false);
  });

  it('counts as started once the steps are pending again with none failed', () => {
    const done = { ...CLIP_FIXTURE, stages: stages() };
    expect(analysing(done)).toBe(false);
    expect(analysisStarted(done)).toBe(false);
    const failedClip = {
      ...CLIP_FIXTURE,
      asset: { ...CLIP_FIXTURE.asset, index: { ...CLIP_FIXTURE.asset.index, state: 'failed' as const } },
      stages: stages({ 'vision.shots': { state: 'failed' } }, 'waiting'),
    };
    // A failed clip's later steps wait too: that isn't the new run.
    expect(analysisStarted(failedClip)).toBe(false);
    expect(analysisStarted(again({ 'library.hash': { state: 'done' } }))).toBe(true);
  });
});

describe('the time left', () => {
  const clock = (fractions: Record<string, number> = {}) => ({
    now: NOW,
    fractionOf: (stage: Stage) => fractions[stage.stage] ?? stage.progress ?? null,
  });

  it('scales what a running step took by how far its job says it is, or uses its usual length here', () => {
    const running: Stage = {
      stage: 'audio.transcript',
      state: 'running',
      startedAt: NOW - 3_000,
      typicalMs: 3_400,
    };
    expect(stageLeftMs(running, clock({ 'audio.transcript': 0.5 }))).toBe(3_000);
    // Too early to trust: its usual length less what has passed, never under a tenth of it.
    expect(stageLeftMs(running, clock({ 'audio.transcript': 0.01 }))).toBe(400);
    expect(stageLeftMs({ ...running, startedAt: NOW - 10_000 }, clock())).toBe(340);
    expect(stageLeftMs({ stage: 'vision.describe', state: 'running' }, clock())).toBeNull();
    expect(stageLeftMs({ stage: 'vision.describe', state: 'waiting', typicalMs: 7_500 }, clock())).toBe(
      7_500,
    );
    expect(stageLeftMs({ stage: 'vision.describe', state: 'done' }, clock())).toBe(0);
  });

  it('adds the steps up, leaves out what waits for a model, and says nothing it can’t know', () => {
    const rows: Stage[] = [
      { stage: 'vision.embed', state: 'running', startedAt: NOW - 1_000, typicalMs: 1_200 },
      { stage: 'vision.describe', state: 'waiting', typicalMs: 7_500 },
      { stage: 'audio.language', state: 'waiting', reasonKey: 'library.stage.modelMissing' },
    ];
    expect(timeLeftMs(rows, clock({ 'vision.embed': 0.5 }))).toBe(8_500);
    expect(timeLeftMs([...rows, { stage: 'library.place', state: 'waiting' }], clock())).toBeNull();
  });

  it('reads as people say it: ten seconds at least, then fives, then whole minutes, rounded up', () => {
    expect([400, 3_000, 10_000, 11_000, 44_100, 61_000, 150_000].map(roundedLeftMs)).toEqual([
      null,
      10_000,
      10_000,
      15_000,
      45_000,
      120_000,
      180_000,
    ]);
  });

  it('fills a group’s bar with its settled steps and the running one’s share', () => {
    const detail = fresh([
      { stage: 'audio.language', state: 'done' },
      { stage: 'audio.transcript', state: 'running', jobId: 'j' as Stage['jobId'] },
    ]);
    const sound = analysisGroups(detail).find((group) => group.key === 'sound')!;
    expect(groupFraction(sound, () => 0.5)).toBe(0.75);
    expect(groupFraction(sound, () => null)).toBe(0.5);
  });
});
