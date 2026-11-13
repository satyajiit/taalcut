// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A workspace composition's stills (HFW1 hf, `workspaceFrames`): read from the project's workspace blobs, drawn
 * offline over grey and over a given picture, each still with where its content sits (null before it enters),
 * the checks with what to fix, and the same pictures when the frames are drawn out of order.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, workspaceBlobPath, workspaceFramesOutputSchema } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neutralPng } from '../../src/workspace/frames/still';
import { workspaceFramesOn } from '../../src/workspace/frames/frames';
import { testEngine } from '../support/engine';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { fixtureText } from './support';

const media = await findTestMedia('workspace frames');
const shell = findTestShell('workspace frames');
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe.skipIf(!media.binaries || !shell.path)(
  'a workspace composition’s stills',
  { timeout: 300_000 },
  () => {
    let work: Awaited<ReturnType<typeof tempDir>>;
    const project = newId<'Project'>();
    let files: { path: string; sha256: string; bytes: number }[] = [];

    beforeAll(async () => {
      work = await tempDir('taalcut-frames-');
      // The headline appears 0.2 s in; a small change makes the letters exit before 4 s.
      const html = await fixtureText('headline.html');
      const blob = join(work.dir, workspaceBlobPath(project, sha(html)));
      await mkdir(join(blob, '..'), { recursive: true });
      await writeFile(blob, html);
      files = [{ path: 'index.html', sha256: sha(html), bytes: Buffer.byteLength(html) }];
    });
    afterAll(async () => {
      await work?.dispose();
    });

    const run = (over: Parameters<typeof workspaceFramesOn>[1]['over'], seconds: number[]) => {
      const engine = testEngine(work.dir, mediaContext(media.binaries!), shell.path!, {
        workspaceRoot: work.dir,
      });
      return workspaceFramesOn(engine.deps, {
        projectId: project,
        entry: 'index.html',
        files,
        params: { title: 'Made up words' },
        seconds,
        over,
        maxDimension: 640,
      });
    };

    it('draws stills over grey with each one’s content box, the checks and steady seeks', async () => {
      const result = await run({ kind: 'grey' }, [0, 0.3, 1.5, 3.9]);
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
      const output = workspaceFramesOutputSchema.parse(result.value);
      expect(output.frames.map((frame) => [frame.width, frame.height])).toEqual(
        Array.from({ length: 4 }, () => [360, 640]),
      );
      // Before the letters rise (masked, below their line) and the underline draws, nothing shows.
      expect(output.frames[0]?.box).toBeNull();
      const settled = output.frames[2]?.box;
      expect(settled).toBeTruthy();
      // The card sits 90 px in from each side, its top at 620 of 1920.
      expect(settled!.x).toBeGreaterThan(80 / 1080);
      expect(settled!.x).toBeLessThan(100 / 1080);
      expect(settled!.y).toBeGreaterThan(600 / 1920);
      expect(settled!.y + settled!.height).toBeLessThan(1);
      const status = Object.fromEntries(output.checks.map((check) => [check.id, check.status]));
      expect(status).toMatchObject({
        bounds: 'pass',
        typeFloor: 'pass',
        seekDeterminism: 'pass',
        network: 'pass',
      });
      // White words straight on the picture: left to the vision judge.
      expect(status.contrast).toBe('skipped');
      expect(output.ms).toBeLessThan(60_000);
    });

    it('draws over a given picture, and refuses a composition the workspace does not hold', async () => {
      const picture = neutralPng([0x10, 0x60, 0x20]).toString('base64');
      const result = await run({ kind: 'image', mimeType: 'image/png', dataBase64: picture }, [1.5]);
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
      expect(result.value.frames).toHaveLength(1);
      expect(result.value.frames[0]?.box).toBeTruthy();
      const engine = testEngine(work.dir, mediaContext(media.binaries!), shell.path!, {
        workspaceRoot: work.dir,
      });
      const missing = await workspaceFramesOn(engine.deps, {
        projectId: project,
        entry: 'index.html',
        files: [{ path: 'index.html', sha256: sha('absent'), bytes: 6 }],
        seconds: [1],
        over: { kind: 'grey' },
      });
      expect(missing.ok).toBe(false);
    });
  },
);
