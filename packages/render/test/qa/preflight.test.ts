// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Preflight: media present and unchanged, fonts byte-for-byte, the music path's rights, and runPreflight. */
import { copyFile, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MUSIC_COMMANDS } from '@taalcut/core';
import { presetFor } from '../../src/presets/presets.v1';
import {
  preflightFontsCheck,
  preflightMediaCheck,
  rightsReferenceAudioCheck,
  sha256File,
  type MediaCheckItem,
} from '../../src/qa/checks/preflight';
import { preflightPassed, runPreflight } from '../../src/qa/run-preflight';
import { tempDir } from '../support/media';
import { captions, qaPlan, target } from './support';

const FONTS = join(import.meta.dirname, '../../fonts');

describe('preflight', () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  const items: MediaCheckItem[] = [];

  beforeAll(async () => {
    work = await tempDir('qa-preflight');
    for (const name of ['a', 'b', 'c']) {
      const path = join(work.dir, `${name}.mov`);
      await writeFile(path, `clip ${name} bytes`);
      const info = await stat(path);
      items.push({
        clipId: `clip-${name}`,
        assetId: `asset-${name}`,
        name: `${name}.mov`,
        path,
        expected: { size: info.size, mtimeMs: info.mtimeMs, contentHash: `hash-${name}` },
      });
    }
  });
  afterAll(() => work.dispose());

  describe('preflightMedia', () => {
    it('passes a timeline over present, unchanged files', async () => {
      const result = await preflightMediaCheck({ items });
      expect(result.status).toBe('pass');
      expect(result.labelKey).toBe('qa.checks.preflightMedia');
    });

    it('fails a deleted file and offers relink, then a swap', async () => {
      const gone = { ...items[0]!, path: join(work.dir, 'missing.mov') };
      const result = await preflightMediaCheck({ items: [gone, items[1]!] });
      expect(result.status).toBe('fail');
      expect(result.overridable).toBe(false);
      expect(result.findings).toEqual([{ target: { kind: 'clip', id: 'clip-a' }, measured: { value: 0, unit: 'count' } }]);
      expect(result.fixes).toEqual([
        { kind: 'agent', instructionKey: 'qa.fixes.relinkMedia', params: { assetId: 'asset-a' } },
        { kind: 'agent', instructionKey: 'qa.fixes.swapFromAlternates', params: { clipId: 'clip-a' } },
      ]);
    });

    it('treats an offline asset (no path) as missing', async () => {
      const result = await preflightMediaCheck({ items: [{ ...items[1]!, path: null }] });
      expect(result.status).toBe('fail');
    });

    it('fails a rewritten file whose content hash changed, and passes a touched one whose hash did not', async () => {
      const rewritten = items[2]!;
      await writeFile(rewritten.path!, 'clip c, different bytes');
      const changed = await preflightMediaCheck({ items: [rewritten], hashFile: async () => 'hash-other' });
      expect(changed.status).toBe('fail');
      expect(changed.fixes[0]).toEqual({ kind: 'agent', instructionKey: 'qa.fixes.mediaChanged', params: { assetId: 'asset-c' } });
      const touched = items[1]!;
      await utimes(touched.path!, new Date(), new Date(Date.now() + 60_000));
      const same = await preflightMediaCheck({ items: [touched], hashFile: async () => 'hash-b' });
      expect(same.status).toBe('pass');
    });

    it('fails when a conform segment is missing after conforming', async () => {
      const result = await preflightMediaCheck({
        items: [],
        segments: [{ clipId: 'clip-a', path: join(work.dir, 'segment-a.mp4') }],
      });
      expect(result.status).toBe('fail');
      expect(result.findings[0]?.target).toEqual({ kind: 'clip', id: 'clip-a' });
    });
  });

  describe('preflightFonts', () => {
    it('passes the bundled fonts against fonts.lock.json, and fails one flipped byte', async () => {
      const lock = JSON.parse(await readFile(join(FONTS, 'fonts.lock.json'), 'utf8')) as {
        files: { file: string; sha256: string }[];
      };
      const entry = lock.files.find((file) => file.file.startsWith('Mukta'))!;
      const original = join(FONTS, entry.file);
      expect(await sha256File(original)).toBe(entry.sha256);
      expect((await preflightFontsCheck([{ ...entry, path: original }])).status).toBe('pass');

      const damaged = join(work.dir, entry.file);
      await copyFile(original, damaged);
      const bytes = await readFile(damaged);
      const middle = bytes.length >> 1;
      bytes[middle] = bytes[middle]! ^ 0xff;
      await writeFile(damaged, bytes);
      const result = await preflightFontsCheck([{ ...entry, path: damaged }]);
      expect(result.status).toBe('fail');
      expect(result.fixes).toEqual([]);
      expect(result.findings[0]?.target).toEqual({ kind: 'file', id: entry.file });
      await rm(damaged);
      expect((await preflightFontsCheck([{ ...entry, path: damaged }])).status).toBe('fail');
    });
  });

  describe('rightsReferenceAudio', () => {
    const rights = (music: 'platformSound' | 'ownTrack' | 'referenceAudio', referenceAudio: boolean) =>
      rightsReferenceAudioCheck({ music, referenceAudio, target });

    it("passes path d with no acknowledgement: the reel's music is the default (REF1)", async () => {
      const result = await rights('referenceAudio', true);
      expect(result.status).toBe('pass');
      expect(result.findings).toEqual([]);
    });

    it('fails a path-a plan forced to include the reference source, offering platform sound', async () => {
      const result = await rights('platformSound', true);
      expect(result.status).toBe('fail');
      expect(result.overridable).toBe(false);
      expect(result.findings[0]?.target).toEqual({ kind: 'audio', id: 'referenceSource' });
      expect(result.fixes).toEqual([
        {
          kind: 'command',
          labelKey: 'qa.fixes.usePlatformSound',
          command: MUSIC_COMMANDS.choosePath,
          payload: { ...target, choice: { path: 'platformSound' } },
        },
      ]);
      expect((await rights('ownTrack', true)).status).toBe('fail');
      expect((await rights('ownTrack', false)).status).toBe('pass');
    });
  });

  describe('runPreflight', () => {
    const input = {
      plan: qaPlan(),
      preset: presetFor('reels'),
      target,
      media: { items: [] },
      fonts: [],
    };

    it('runs the five preflight checks and lets a clean timeline render', async () => {
      const results = await runPreflight({ ...input, captions: captions([{ id: 'c1', start: 0, frames: 30, text: 'नमस्ते दुनिया' }]) });
      // 2 s for Reels is under its 3 s minimum: duration fails at preflight, before any render.
      expect(results.map((check) => [check.id, check.status])).toEqual([
        ['preflightMedia', 'pass'],
        ['preflightFonts', 'pass'],
        ['rightsReferenceAudio', 'pass'],
        ['duration', 'fail'],
        ['captionGlyphs', 'pass'],
      ]);
      expect(preflightPassed(results)).toBe(false);
      const longer = await runPreflight({ ...input, plan: qaPlan({ durationFrames: 300 }), captions: null });
      expect(preflightPassed(longer)).toBe(true);
    });

    it('fails Tamil captions before rendering with the real cmap coverage', async () => {
      const results = await runPreflight({ ...input, captions: captions([{ id: 'c1', start: 0, frames: 30, text: 'தமிழ்' }]) });
      expect(results.find((check) => check.id === 'captionGlyphs')?.status).toBe('fail');
    });
  });
});
