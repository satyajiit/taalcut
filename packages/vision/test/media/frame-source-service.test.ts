// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-G3 in vision, with no FFmpeg and no helper: with a decode service, the frame source reads `vision.embed`'s
 * frames in one service request (one decoder session) and one CPU conversion instead of an FFmpeg seek per window,
 * keeps them in the asset's cache (a second read decodes nothing), and `embedAsset` embeds them as before. Without
 * one, or when the service declines, the source seeks with FFmpeg as before.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok } from '@taalcut/core';
import {
  SidecarRejected,
  type DecodeFramesRequest,
  type DecodeService,
  type MediaContext,
  type ProcessOutput,
  type ProcessRunner,
} from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { embedAsset } from '../../src/embed/embed-asset';
import { createEmbedder } from '../../src/embed/embedder';
import { DEFAULT_EMBEDDING_PROFILE } from '../../src/embed/profile';
import { EMBEDDING_SPACE, embeddingFrameSize } from '../../src/embed/space';
import { openFrameSource } from '../../src/media/media-frame-source';
import { fakeVideoPlan } from '../helpers/fake-frame-source';
import { fakeLoader } from '../helpers/fake-model';
import { memoryVectorIndex } from '../helpers/vector-index';

const done: ProcessOutput = {
  exitCode: 0,
  signal: null,
  stdout: Buffer.alloc(0),
  stderrTail: '',
  durationMs: 1,
};
const plan = fakeVideoPlan(300, 1920, 1080);
const size = embeddingFrameSize(1920, 1080, DEFAULT_EMBEDDING_PROFILE.imageTokens);

/** FFmpeg: a seek (a filter graph) fails; a conversion of the service's NV12 writes one rgb24 frame per frame asked. */
function fakeRunner(calls: string[][], frames: () => number): ProcessRunner {
  return async (_command, args) => {
    calls.push([...args]);
    if (args.includes('-filter_complex')) return ok({ ...done, exitCode: 1, stderrTail: 'no seeks here' });
    const out = args.at(-1) ?? '';
    await writeFile(out, Buffer.alloc(frames() * size.width * size.height * 3, 9));
    return ok(done);
  };
}

function fakeService(
  answer: 'writes' | 'declines',
): DecodeService & { readonly asked: DecodeFramesRequest[] } {
  const asked: DecodeFramesRequest[] = [];
  return {
    id: 'fake',
    asked,
    pass: async () => err(SidecarRejected({ helperCode: 'decode.unsupported' })),
    async frames(request, options) {
      asked.push(request);
      // The reply: the service has let go of its session.
      options?.onLetGo?.();
      if (answer === 'declines') return err(SidecarRejected({ helperCode: 'decode.unsupported' }));
      for (const set of request.sets)
        await writeFile(set.path, Buffer.alloc(set.frames.length * set.width * set.height * 1.5, 4));
      return ok({ written: request.sets.map((set) => [...set.frames]), decoded: 60, reads: 2, ms: 30 });
    },
    avoid: () => {},
    avoided: () => undefined,
    close: async () => {},
  };
}

describe('the frame source with a decode service', () => {
  let dir: string;
  let calls: string[][];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-source-service-'));
    calls = [];
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const media = (frames: () => number): MediaContext => ({
    binaries: { ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe', source: 'dev-build' },
    runner: fakeRunner(calls, frames),
  });

  it("reads vision.embed's frames in one service request, keeps them, and embeds them", async () => {
    const service = fakeService('writes');
    const wanted = [3, 90, 200];
    const opened = await openFrameSource(
      { media: media(() => wanted.length), tempDir: dir, decodeService: service },
      { assetId: 'a', path: '/clips/clip.mov', plan },
    );
    if (!opened.ok) throw new Error(opened.error.code);
    const source = opened.value;
    const loader = fakeLoader();
    const embedder = createEmbedder({ modelDir: '/m', loader, profile: DEFAULT_EMBEDDING_PROFILE });
    const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, 768);
    const embedded = await embedAsset(
      {
        assetId: 'a',
        sourceId: 's',
        path: '/clips/clip.mov',
        frames: [{ shotId: 'x', frames: [90, 3, 200] }],
        texts: [],
      },
      { media: media(() => wanted.length), embedder, index, frames: source },
    );
    expect(embedded.ok && embedded.value.frames).toBe(3);
    expect(service.asked).toHaveLength(1);
    expect(service.asked[0]?.sets).toEqual([expect.objectContaining({ ...size, frames: wanted })]);
    // One CPU conversion; FFmpeg never seeks.
    expect(calls).toHaveLength(1);
    expect(calls.flat()).not.toContain('-hwaccel');
    // Kept: the same frames again come from the asset's cache.
    const again = await source.frames({ size, format: 'rgb24', frames: wanted });
    expect(again.ok && again.value.map((f) => f.index)).toEqual(wanted);
    expect(service.asked).toHaveLength(1);
    expect(source.decodes()).toMatchObject({ partialDecodes: 1 });
    await source.close();
    await embedder.close();
  });

  it('seeks with FFmpeg when the service declines the file', async () => {
    const service = fakeService('declines');
    const opened = await openFrameSource(
      { media: media(() => 1), tempDir: dir, decodeService: service },
      { assetId: 'b', path: '/clips/clip.mov', plan },
    );
    if (!opened.ok) throw new Error(opened.error.code);
    const read = await opened.value.frames({ size, format: 'rgb24', frames: [3] });
    expect(service.asked).toHaveLength(1);
    // FFmpeg's seek ran (the fake fails it).
    expect(read.ok).toBe(false);
    expect(calls.some((args) => args.includes('-filter_complex'))).toBe(true);
    await opened.value.close();
  });
});
