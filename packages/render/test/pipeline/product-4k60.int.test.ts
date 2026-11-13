// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  FrameRate,
  newId,
  RationalTime,
  unwrap,
  workspaceBlobPath,
  type AuthoredProgram,
} from '@taalcut/core';
import { createAuthoredTimeline } from '@taalcut/timeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEngine } from '../support/engine';
import { checkStatus, exportToEnd, failing, queueRender } from '../support/export-record';
import { findTestMedia, mediaContext, patchColour, probeJson, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { finishRender } from '../../src/engine/finish';
import { presetFor } from '../../src/presets/presets.v1';

const media = await findTestMedia('product 4K60 output');
const shell = findTestShell('product 4K60 output');
const rate = FrameRate.of(60);
const stripes = Array.from(
  { length: 20 },
  (_, index) =>
    `<div class="stripe" style="left:${index * 80}px;background:${index % 2 ? '#539db7' : '#f4b144'}"></div>`,
).join('');
const source = `<template><style>
#root { position: relative; width: 3840px; height: 2160px; background: #263b53; }
#panel { position: absolute; left: 400px; top: 500px; width: 1600px; height: 1000px; }
.stripe { position: absolute; top: 0; width: 80px; height: 1000px; }
</style><div id="root" data-composition-id="smoke" data-width="3840" data-height="2160" data-duration="1">
<div id="panel" data-hf-id="panel">${stripes}</div></div>
<script>const tl = gsap.timeline({ paused: true });
tl.fromTo('#panel', { x: 0 }, { x: 1600, duration: 1, ease: 'none' }, 0);
window.__timelines['smoke'] = tl;</script></template>`;

/** A real authored composition, GPU-first picture/finishing, final mux and the production QA gate. */
describe.skipIf(!media.binaries || !shell.path)('product 4K60 actual output', { timeout: 600_000 }, () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  beforeAll(async () => {
    work = await tempDir('product-4k60');
  });
  afterAll(async () => {
    await work?.dispose();
  });

  it('encodes all 60 moving frames at native 3840×2160 and passes level-aware format QA', async () => {
    const projectId = newId<'Project'>();
    const hash = createHash('sha256').update(source).digest('hex');
    const blob = join(work.dir, 'authored', workspaceBlobPath(projectId, hash));
    await mkdir(dirname(blob), { recursive: true });
    await writeFile(blob, source);
    const program: AuthoredProgram = {
      id: newId<'AuthoredProgram'>(),
      hash,
      version: 1,
      entry: 'index.html',
      files: [{ path: 'index.html', sha256: hash, bytes: Buffer.byteLength(source) }],
      canvas: { width: 3840, height: 2160, rate },
      duration: RationalTime.of(60, rate),
      assetIds: [],
      chapters: [],
    };
    const timeline = unwrap(createAuthoredTimeline({ projectId, name: '4K60 motion smoke', program }));
    const ctx = mediaContext(media.binaries!);
    const logs: string[] = [];
    const engine = testEngine(work.dir, ctx, shell.path!, {
      workers: 1,
      workspaceRoot: work.dir,
      log: (line) => logs.push(line),
    });
    const record = await queueRender(engine, timeline, {
      presetId: 'landscape4k',
      burnCaptions: false,
      includeBumpers: false,
    });
    const rendered = await exportToEnd(engine, record);
    expect(failing(rendered)).toEqual([]);
    expect(rendered.status).toBe('ready');
    for (const id of ['container', 'codec', 'resolution', 'aspectRatio', 'frameRate', 'duration'])
      expect(checkStatus(rendered, id), id).toBe('pass');
    const probe = await probeJson(
      ctx,
      rendered.filePath!,
      'stream=codec_type,codec_name,profile,level,width,height,r_frame_rate,avg_frame_rate,nb_read_packets',
    );
    const video = (probe['streams'] as Record<string, unknown>[]).find(
      (stream) => stream['codec_type'] === 'video',
    )!;
    expect(video).toMatchObject({
      codec_name: 'h264',
      profile: 'High',
      width: 3840,
      height: 2160,
      r_frame_rate: '60/1',
      avg_frame_rate: '60/1',
      nb_read_packets: '60',
    });
    expect(video['level']).toBeGreaterThanOrEqual(52);
    expect(video['level']).toBeLessThanOrEqual(52);
    const start = await patchColour(ctx, rendered.filePath!, 0, { x: 800, y: 1000, size: 8 });
    const end = await patchColour(ctx, rendered.filePath!, 59, { x: 800, y: 1000, size: 8 });
    expect(start.reduce((sum, value, index) => sum + Math.abs(value - end[index]!), 0)).toBeGreaterThan(80);
    const route = logs.find((line) => line.includes('[render] picture:'));
    expect(route).toBeTruthy();
    const finished = unwrap(
      await finishRender({
        video: rendered.filePath!,
        audio: rendered.filePath!,
        out: join(work.dir, 'reencoded.mp4'),
        preset: presetFor('landscape4k'),
        rate,
        ctx,
        reencode: true,
      }),
    );
    const reencoded = await probeJson(
      ctx,
      finished.path,
      'stream=codec_type,level,width,height,avg_frame_rate,nb_read_packets',
    );
    expect(
      (reencoded['streams'] as Record<string, unknown>[]).find((stream) => stream['codec_type'] === 'video'),
    ).toMatchObject({
      level: 52,
      width: 3840,
      height: 2160,
      avg_frame_rate: '60/1',
      nb_read_packets: '60',
    });
  });
});
