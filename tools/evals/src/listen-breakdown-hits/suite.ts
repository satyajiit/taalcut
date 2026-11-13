// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-breakdown-hits (EAR1-I3 over EAR1-C1): F2's fixture films (tools/earshot-parity: 32 to 35 hard cuts each,
 * hits planted at known offsets) broken down as reels by @taalcut/templates' `runBreakdown`, through its listening
 * stage, and the template's cut-sync status at each of the film's cuts held against upstream earshot's own status
 * for that cut (`timeline --video`). A cut the breakdown missed counts against the film.
 *
 * The reel is the film's picture with its sound as made (ALAC in MP4). The breakdown runs on the eval's analysers
 * (src/breakdown/analysers.ts: media's probe, vision's scene scores, FFmpeg steps) and the listening on audio's
 * `analyseSound` decoding the reel with FFmpeg, signal processing only: cut sync needs no model, so the suite needs
 * FFmpeg and nothing else. The bar (plan C1): ≥ 90% of a film's cuts agree, on ≥ 3 films.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyseSound, createSpectrogramRunner } from '@taalcut/audio';
import { newId, ok, systemClock, type CutSyncStatus, type Template } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import {
  breakdownListener,
  buildTemplate,
  runBreakdown,
  type BreakdownMedia,
  type TemplateIds,
} from '@taalcut/templates';
import { clip, clips, cliRun, writeClip, writeFilmVideo } from '../../../earshot-parity/fixtures.mjs';
import { evalBreakdownAnalysers } from '../breakdown/analysers';
import { runFfmpeg } from '../ffmpeg-run';
import { ffmpegHere } from '../listening/environment';
import { barsOf, outcomeOf, type ListenOutcome } from '../listening/outcome';

type Runner = ReturnType<typeof createSpectrogramRunner>;

const STATUS: Readonly<Record<string, CutSyncStatus>> = {
  OK: 'ok',
  near: 'near',
  swell: 'swell',
  peak: 'peak',
  off: 'off',
  'no sound': 'none',
};

export interface FilmTruth {
  readonly id: string;
  /** The film's cuts, frames. */
  readonly cuts: readonly number[];
  /** Upstream's status for each cut, in order. */
  readonly statuses: readonly CutSyncStatus[];
}

export function filmTruth(id: string): FilmTruth {
  const row = clip(id);
  const fps = Number(row.truth['fps']);
  const items =
    cliRun<{ sync: { cuts?: { items: { status: string }[] } } }>('timeline', id).sync.cuts?.items ?? [];
  return {
    id,
    cuts: (row.truth.cuts ?? []).map((t) => Math.round(t * fps)),
    statuses: items.map((item) => STATUS[item.status] ?? 'none'),
  };
}

/** The share of the film's cuts whose status in the template is upstream's, and the cuts the breakdown missed. */
export function agreement(
  truth: FilmTruth,
  template: Template,
): { agree: number; same: number; missed: number } {
  const items = template.audio.listening?.cutSync.items ?? [];
  const statusAt = new Map(items.map((item) => [template.slots[item.cutIndex]?.start.value, item.status]));
  const heard = truth.cuts.map((frame) => statusAt.get(frame));
  const same = heard.filter((status, k) => status === truth.statuses[k]).length;
  return {
    agree: truth.cuts.length > 0 ? same / truth.cuts.length : 0,
    same,
    missed: heard.filter((s) => s === undefined).length,
  };
}

/** The eval's frame step picks frames with one FFmpeg select expression: at most 40 frames a run. */
function inBatches(extract: BreakdownMedia['extractFrames']): BreakdownMedia['extractFrames'] {
  return async (path, frames, options) => {
    const paths: string[] = [];
    for (let start = 0; start < frames.length; start += 40) {
      const batch = await extract(path, frames.slice(start, start + 40), options);
      if (!batch.ok) return batch;
      paths.push(...batch.value);
    }
    return ok(paths);
  };
}

async function reelOf(id: string, dir: string, ctx: MediaContext): Promise<string> {
  const video = await writeFilmVideo(id, dir, ctx.binaries.ffmpeg);
  const wav = writeClip(id, dir);
  const reel = join(dir, 'reel.mp4');
  await runFfmpeg(ctx.binaries.ffmpeg, [
    ...['-v', 'error', '-y', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a'],
    ...['-c:v', 'copy', '-c:a', 'alac', reel],
  ]);
  return reel;
}

async function breakDown(id: string, root: string, ctx: MediaContext, runner: Runner): Promise<Template> {
  const dir = join(root, id);
  mkdirSync(join(dir, 'experiment'), { recursive: true });
  const analysers = evalBreakdownAnalysers(ctx);
  const listen = breakdownListener(
    (request) => analyseSound({ media: async () => ok(ctx), spectrograms: async () => runner }, request),
    { install: false, models: false },
  );
  const draft = await runBreakdown(
    {
      breakdownId: newId(),
      referencePath: await reelOf(id, dir, ctx),
      input: 'file',
      platform: null,
      url: null,
    },
    {
      ...analysers,
      media: { ...analysers.media, extractFrames: inBatches(analysers.media.extractFrames) },
      audio: { ...analysers.audio, listen },
      experimentDir: join(dir, 'experiment'),
      clock: systemClock,
    },
    { signal: new AbortController().signal },
  );
  if (!draft.ok) throw new Error(`${id}: ${draft.error.code} ${draft.error.detail ?? ''}`);
  if (!draft.value.audio.listening)
    throw new Error(`${id}: the breakdown kept no listening (${draft.value.warnings.join(', ')})`);
  const ids: TemplateIds = { template: () => newId(), slot: () => newId(), overlay: () => newId() };
  const built = buildTemplate(draft.value, [], [], ids, { createdAt: 1 });
  if (!built.ok) throw new Error(`${id}: ${built.error.detail ?? built.error.code}`);
  return built.value;
}

export async function runBreakdownHitsSuite(films = clips('film').map((c) => c.id)): Promise<ListenOutcome> {
  const started = performance.now();
  const seconds = () => (performance.now() - started) / 1000;
  const ffmpeg = await ffmpegHere();
  if ('reason' in ffmpeg)
    return outcomeOf('listen-breakdown-hits', {
      metrics: [],
      skipped: [{ part: 'films', reason: ffmpeg.reason }],
      seconds: seconds(),
    });
  const ctx: MediaContext = { binaries: ffmpeg.found };
  const bar = barsOf('listen-breakdown-hits')['cutSyncAgreement'] ?? 0.9;
  const root = mkdtempSync(join(tmpdir(), 'taalcut-listen-breakdown-'));
  // The spectrograms on the listen device plan (GPU first), as the app's breakdown and listen-parity run them.
  const runner = createSpectrogramRunner();
  const notes: string[] = ['| film | cuts | agree | missed |', '| --- | --- | --- | --- |'];
  let cuts = 0;
  let agreed = 0;
  let worst = 1;
  let atBar = 0;
  try {
    for (const id of films) {
      const truth = filmTruth(id);
      const { agree, same, missed } = agreement(truth, await breakDown(id, root, ctx, runner));
      notes.push(`| ${id} | ${truth.cuts.length} | ${(agree * 100).toFixed(1)}% | ${missed} |`);
      cuts += truth.cuts.length;
      agreed += same;
      worst = Math.min(worst, agree);
      if (agree >= bar) atBar += 1;
    }
  } finally {
    await runner.release();
    rmSync(root, { recursive: true, force: true });
  }
  const part = 'films';
  return outcomeOf('listen-breakdown-hits', {
    metrics: [
      {
        name: 'filmsAtBar',
        value: atBar,
        better: 'higher',
        part,
        over: `${films.length} films at ≥ ${bar * 100}%`,
      },
      {
        name: 'cutSyncAgreement',
        value: cuts > 0 ? agreed / cuts : null,
        better: 'higher',
        part,
        over: `${cuts} cuts`,
      },
      { name: 'worstFilmAgreement', value: films.length > 0 ? worst : null, better: 'higher', part },
    ],
    notes,
    seconds: seconds(),
  });
}
