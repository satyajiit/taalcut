// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-OEM: what phones write into a `moov` that ffprobe's tags miss, laid out as in real files. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { childBoxes, metaKeys, readMovieBox, threeGppText } from '../../src/probe/boxes';
import { phoneMetadataOf } from '../../src/probe/map';
import { phoneBoxesOf } from '../../src/probe/phone-boxes';
import {
  box,
  fullBox,
  metaBox,
  quickTimeTextBox,
  samsungUserData,
  threeGppBox,
  track,
} from '../helpers/mp4-boxes';

/** 20260314_113000.mp4's format tags, as ffprobe prints them. */
const SAMSUNG_TAGS = {
  major_brand: 'mp42',
  creation_time: '2026-03-14T09:30:00.000000Z',
  'com.android.version': '16',
  'com.android.capture.fps': '30.000000',
  'com.samsung.android.utc_offset': '+0200',
};

const samsungMovie = () =>
  box(
    'moov',
    samsungUserData(),
    metaBox({
      'com.android.version': '16',
      'com.android.capture.fps': 30,
      'com.samsung.android.utc_offset': '+0200',
    }),
    track('vide'),
    track('soun'),
  );

/** apple-livephoto-quicktime.mov (iPhone 14 Pro, metadata-extractor-images): the lens is in the video track. */
const iphoneMovie = () =>
  box(
    'moov',
    metaBox({ 'com.apple.quicktime.make': 'Apple', 'com.apple.quicktime.model': 'iPhone 14 Pro' }),
    track(
      'vide',
      metaBox({
        'com.apple.quicktime.camera.lens_model': 'iPhone 14 Pro back camera 2.22mm f/2.2',
        'com.apple.quicktime.camera.focal_length.35mm_equivalent': 13,
      }),
    ),
    track('soun'),
  );

describe('boxes', () => {
  it('pairs keys with their values, as text and as ffprobe prints numbers', () => {
    const meta = metaBox({ 'com.android.version': '16', 'com.android.capture.fps': 30 });
    expect(metaKeys(meta, childBoxes(meta)[0]!)).toEqual({
      'com.android.version': '16',
      'com.android.capture.fps': '30.000000',
    });
  });

  it('reads meta written as a QuickTime container or as an ISO full box', () => {
    const full = metaBox({ 'com.apple.quicktime.make': 'Apple' }, true);
    expect(metaKeys(full, childBoxes(full)[0]!)).toEqual({ 'com.apple.quicktime.make': 'Apple' });
  });

  it('reads 3GPP text in UTF-8 and UTF-16', () => {
    for (const encoding of ['utf8', 'utf16'] as const) {
      const auth = threeGppBox('auth', 'Galaxy Example', encoding);
      expect(threeGppText(auth, childBoxes(auth)[0]!)).toBe('Galaxy Example');
    }
  });

  it('stops at a box whose size runs past its parent, keeping the ones before it', () => {
    const good = box('free', Buffer.alloc(4));
    const bad = Buffer.alloc(8);
    bad.writeUInt32BE(4096, 0);
    bad.write('udta', 4, 'latin1');
    expect(childBoxes(Buffer.concat([good, bad])).map((b) => b.type)).toEqual(['free']);
    expect(childBoxes(Buffer.from([0, 0, 0, 3, 0x6d]))).toEqual([]);
  });
});

describe('phoneBoxesOf', () => {
  it("reads a Galaxy Example's name and model number from udta", () => {
    expect(phoneBoxesOf(samsungMovie())).toMatchObject({
      author: 'Galaxy Example',
      samsungAtom: true,
      samsungModel: 'SM-X000Z',
      movieKeys: { 'com.samsung.android.utc_offset': '+0200' },
      videoKeys: {},
    });
  });

  it("reads the lens from the iPhone's video track, not the sound track", () => {
    expect(phoneBoxesOf(iphoneMovie()).videoKeys).toEqual({
      'com.apple.quicktime.camera.lens_model': 'iPhone 14 Pro back camera 2.22mm f/2.2',
      'com.apple.quicktime.camera.focal_length.35mm_equivalent': '13.000000',
    });
  });

  it('reads QuickTime make and model text', () => {
    const movie = box('moov', box('udta', quickTimeTextBox('©mak', 'HMD'), quickTimeTextBox('©mod', 'X')));
    expect(phoneBoxesOf(movie)).toMatchObject({ make: 'HMD', model: 'X' });
  });

  it('returns nothing from bytes that are not a moov', () => {
    expect(phoneBoxesOf(Buffer.from('not a movie'))).toEqual({
      movieKeys: {},
      videoKeys: {},
      samsungAtom: false,
    });
  });
});

describe('phoneMetadataOf', () => {
  it('names Samsung as the maker of 20260314_113000.mp4, with its phone, model number and offset', () => {
    expect(phoneMetadataOf(SAMSUNG_TAGS, phoneBoxesOf(samsungMovie()))).toEqual({
      make: 'Samsung',
      model: 'Galaxy Example',
      modelCode: 'SM-X000Z',
      software: '16',
      utcOffset: '+0200',
      captureFrameRate: 30,
    });
  });

  it("knows an old Galaxy by Samsung's empty smta atom alone", () => {
    const movie = box('moov', box('udta', box('SDLN', Buffer.from('SEQ_PLAY')), fullBox('smta')));
    expect(phoneMetadataOf({ 'com.android.version': '6.0.1' }, phoneBoxesOf(movie))?.make).toBe('Samsung');
  });

  it('never takes an author box for a phone without Samsung’s own tags', () => {
    const movie = box('moov', box('udta', threeGppBox('auth', 'Asha Rao')));
    expect(phoneMetadataOf({ 'com.android.version': '14' }, phoneBoxesOf(movie))?.model).toBeUndefined();
  });

  it("adds the iPhone's lens and 35 mm focal length", () => {
    const phone = phoneMetadataOf({ 'com.apple.quicktime.make': 'Apple' }, phoneBoxesOf(iphoneMovie()));
    expect(phone).toMatchObject({ lens: 'iPhone 14 Pro back camera 2.22mm f/2.2', focalLength35mm: 13 });
  });

  it('reads a Pixel from the Android keys', () => {
    const tags = {
      'com.android.manufacturer': 'Google',
      'com.android.model': 'Pixel 9 Pro',
      'com.android.capture.fps': '30.000000',
    };
    expect(phoneMetadataOf(tags)).toEqual({ make: 'Google', model: 'Pixel 9 Pro', captureFrameRate: 30 });
  });

  it('names the Sample Cam app and the device it names from VID_0001.mp4’s comment, and no maker', () => {
    const tags = {
      copyright: 'Sample Cam',
      composer: 'Sample Cam',
      comment: 'app=Sample Cam&device=XC01&gid=00000000-0000-4000-8000-000000000000',
    };
    expect(phoneMetadataOf(tags)).toEqual({ app: 'Sample Cam', appDevice: 'XC01' });
    expect(phoneMetadataOf({ comment: 'Shot at the beach' })).toBeUndefined();
  });
});

describe('readMovieBox', () => {
  const dirs: string[] = [];
  afterAll(async () => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  async function file(...boxes: Buffer[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-boxes-'));
    dirs.push(dir);
    const path = join(dir, 'clip.mp4');
    await writeFile(path, Buffer.concat(boxes));
    return path;
  }

  it('finds the moov after the media data, as Samsung and Apple write it', async () => {
    const movie = samsungMovie();
    const path = await file(box('ftyp', Buffer.from('mp42')), box('mdat', Buffer.alloc(100_000)), movie);
    expect((await readMovieBox(path))?.equals(movie)).toBe(true);
  });

  it('finds the moov before the media data, as the Sample Cam app writes it', async () => {
    const movie = box('moov', metaBox({ comment: 'app=Sample Cam&device=XC01' }));
    const path = await file(
      box('ftyp', Buffer.from('isom')),
      movie,
      box('free'),
      box('mdat', Buffer.alloc(10)),
    );
    expect((await readMovieBox(path))?.equals(movie)).toBe(true);
  });

  it('gives up on a file without one, a broken one, or a missing one', async () => {
    expect(await readMovieBox(await file(box('ftyp'), box('mdat', Buffer.alloc(10))))).toBeUndefined();
    expect(await readMovieBox(await file(Buffer.from('JFIF not a movie at all')))).toBeUndefined();
    expect(await readMovieBox('/no/such/clip.mp4')).toBeUndefined();
  });
});
