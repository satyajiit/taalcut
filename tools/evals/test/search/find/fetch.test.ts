// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-FIND: the library folder's names and encode, and a download that doesn't match its SHA-1. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commonsAsset,
  encodeArgs,
  fetchFindLibrary,
  originalName,
  ownerAsset,
} from '../../../src/search/find/fetch';
import { loadClips, type ClipFile } from '../../../src/search/find/schema';

const clip = {
  id: 'dance-rabha',
  shows: 'dancers',
  title: 'File:Rabha Folk Dance.webm',
  page: 'https://commons.wikimedia.org/wiki/File:Rabha_Folk_Dance.webm',
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Rabha_Folk_Dance.webm',
  sha1: '0'.repeat(40),
  bytes: 4,
  licence: 'CC BY-SA 4.0',
  author: 'someone',
  start: 4,
  seconds: 6,
} as const;

describe('the find library folder', () => {
  it('names originals by id and their URL’s extension, and clips by where they came from', () => {
    expect(originalName(clip)).toBe('dance-rabha.webm');
    expect(originalName({ id: 'x', url: 'https://u.org/a/b.ogv?utm=1' })).toBe('x.ogv');
    expect(commonsAsset(clip)).toBe('commons/10000.mp4');
    expect(ownerAsset({ file: '20261022_141500.mp4' })).toBe('owner/20261022_141500.mp4');
  });

  it('names every committed clip by a number of its own that says nothing of what it shows', () => {
    const clips = loadClips(join(import.meta.dirname, '../../../search-find/clips.json')).clips;
    const names = clips.map(commonsAsset);
    expect(new Set(names).size).toBe(clips.length);
    for (const name of names) expect(name).toMatch(/^commons\/\d{5}\.mp4$/);
  });

  it('cuts the window and encodes software H.264 without sound', () => {
    const args = encodeArgs('/in.webm', clip, '/out.mp4');
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2)).toEqual(['-ss', '4']);
    expect(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2)).toEqual(['-t', '6']);
    for (const flag of ['-an', '+bitexact']) expect(args).toContain(flag);
    expect(args).toContain(process.platform === 'darwin' ? 'h264_videotoolbox' : 'libopenh264');
    if (process.platform === 'darwin')
      expect(args.slice(args.indexOf('-require_sw'), args.indexOf('-require_sw') + 2)).toEqual([
        '-require_sw',
        '1',
      ]);
    expect(args.at(-1)).toBe('/out.mp4');
    expect(args.join(' ')).toContain('-color_trc bt709');
    expect(args.join(' ')).not.toContain('tonemap');
    expect(encodeArgs('/in.webm', clip, '/out.mp4', true).join(' ')).toContain('tonemap=hable');
  });

  it('refuses a download whose SHA-1 isn’t the one clips.json names', async () => {
    const out = mkdtempSync(join(tmpdir(), 'taalcut-find-fetch-'));
    try {
      const file: ClipFile = { v: 1, about: '', clips: [clip] };
      const fake = (async () => new Response('webm')) as typeof fetch;
      await expect(
        fetchFindLibrary({
          clips: file,
          out,
          ffmpeg: '/no/ffmpeg',
          ffprobe: '/no/ffprobe',
          fetch: fake,
          log: () => {},
        }),
      ).rejects.toThrow(/SHA-1/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
