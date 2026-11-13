// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shot detection's thresholds at each frame budget (IX-E2): cut confirmation
 * embeds the frames around each candidate at the embedder's frame size, so a
 * smaller budget moves the distances `shots.minDistance` was set on. Runs
 * detectShots with the live model at each budget over a footage set whose
 * manifest lists its cuts (the bench's ix-v1), and scores the cuts against it.
 *
 *   pnpm --filter @taalcut/vision exec tsx scripts/study-cuts.ts --footage <dir> \
 *     [--files a.mp4,b.mov] [--budgets 140,280] [--model <dir>] [--out <file.json>]
 *
 * A hard cut matches a detected cut within 2 frames; a dissolve matches one
 * anywhere in its span (± 2 frames). Needs FFmpeg and the component folder.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createBinaryResolver } from '@taalcut/media';
import { createEmbedder } from '../src/embed/embedder';
import { DEFAULT_EMBEDDING_PROFILE } from '../src/embed/profile';
import { IMAGE_TOKEN_BUDGETS } from '../src/embed/space';
import { detectShots, type ShotCut } from '../src/shots/detect-shots';
import { numberList } from './study/args';

const manifestSchema = z.object({
  clips: z.array(
    z.object({
      file: z.string(),
      fps: z.number().positive(),
      cuts: z.array(z.object({ at: z.number(), kind: z.string(), seconds: z.number() })),
    }),
  ),
});
type Clip = z.infer<typeof manifestSchema>['clips'][number];

const TOLERANCE = 2;

const { values } = parseArgs({
  options: {
    footage: { type: 'string' },
    files: { type: 'string' },
    budgets: { type: 'string', default: '140,280' },
    model: { type: 'string', default: fileURLToPath(new URL('../.cache/embeddinggemma-2', import.meta.url)) },
    out: { type: 'string' },
  },
});

/** Each labelled cut as the frame span a detection may fall in. */
function spans(clip: Clip): { from: number; to: number; kind: string }[] {
  return clip.cuts.map((cut) => {
    const at = Math.round(cut.at * clip.fps);
    const end = Math.round((cut.at + cut.seconds) * clip.fps);
    return { from: at - TOLERANCE, to: Math.max(at, end) + TOLERANCE, kind: cut.kind };
  });
}

interface ClipResult {
  readonly file: string;
  readonly ms: number;
  readonly labelled: number;
  readonly found: number;
  readonly extra: number;
  readonly truthDistances: readonly number[];
  readonly cuts: readonly { frame: number; distance?: number; method: string }[];
  readonly rejected: readonly { frame: number; distance?: number }[];
}

function score(clip: Clip, cuts: readonly ShotCut[]) {
  const labelled = spans(clip);
  const used = new Set<number>();
  let found = 0;
  const truth: number[] = [];
  for (const span of labelled) {
    const hit = cuts.findIndex((cut, i) => !used.has(i) && cut.frame >= span.from && cut.frame <= span.to);
    if (hit < 0) continue;
    used.add(hit);
    found += 1;
    const distance = cuts[hit]?.distance;
    if (distance !== undefined) truth.push(distance);
  }
  return { labelled: labelled.length, found, extra: cuts.length - used.size, truthDistances: truth };
}

const distanceOf = (cut: ShotCut) => (cut.distance === undefined ? {} : { distance: cut.distance });

async function main(): Promise<number> {
  if (!values.footage) throw new Error('--footage <dir> is required');
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(values.footage, 'manifest.json'), 'utf8')),
  );
  const wanted = values.files?.split(',').map((file) => file.trim());
  const clips = manifest.clips.filter((clip) => !wanted || wanted.includes(clip.file));
  const binaries = await createBinaryResolver({ development: true }).resolve();
  if (!binaries.ok) throw new Error(`no FFmpeg: ${binaries.error.code}`);
  const media = { binaries: binaries.value };
  const results = [];
  for (const imageTokens of numberList(values.budgets, IMAGE_TOKEN_BUDGETS, 'budget')) {
    const embedder = createEmbedder({
      modelDir: values.model,
      profile: { ...DEFAULT_EMBEDDING_PROFILE, imageTokens },
      memoEntries: 0,
    });
    const perClip: ClipResult[] = [];
    for (const clip of clips) {
      const started = performance.now();
      const shots = await detectShots(join(values.footage, clip.file), { media, embedder });
      if (!shots.ok) throw new Error(`${clip.file}: ${shots.error.code} ${shots.error.detail ?? ''}`);
      const { cuts, rejected } = shots.value;
      const result: ClipResult = {
        file: clip.file,
        ms: Math.round(performance.now() - started),
        ...score(clip, cuts),
        cuts: cuts.map((cut) => ({ frame: cut.frame, method: cut.method, ...distanceOf(cut) })),
        rejected: rejected.map((cut) => ({ frame: cut.frame, ...distanceOf(cut) })),
      };
      perClip.push(result);
      console.warn(
        `${imageTokens} ${clip.file}: ${result.found}/${result.labelled} found, ${result.extra} extra`,
      );
    }
    const sum = (key: 'labelled' | 'found' | 'extra') => perClip.reduce((n, clip) => n + clip[key], 0);
    const truth = perClip.flatMap((clip) => clip.truthDistances).sort((a, b) => a - b);
    const rejectedDistances = perClip
      .flatMap((clip) => clip.rejected.map((cut) => cut.distance ?? 0))
      .sort((a, b) => b - a);
    results.push({
      imageTokens,
      device: embedder.device(),
      labelled: sum('labelled'),
      found: sum('found'),
      extra: sum('extra'),
      minCutDistance: truth[0] ?? null,
      maxRejectedDistance: rejectedDistances[0] ?? null,
      clips: perClip,
    });
    await embedder.close();
  }
  for (const r of results)
    console.warn(
      `${r.imageTokens} tokens (${r.device}): ${r.found}/${r.labelled} cuts found, ${r.extra} extra; ` +
        `smallest matched distance ${r.minCutDistance?.toFixed(3)}, largest rejected ${r.maxRejectedDistance?.toFixed(3)}`,
    );
  if (values.out) writeFileSync(values.out, `${JSON.stringify(results, null, 1)}\n`);
  return 0;
}

process.exitCode = await main();
