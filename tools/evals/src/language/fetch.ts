// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fetches the LIB1-LANG labelled set (sets.ts) into `<dir>/clips` and writes `<dir>/clips.jsonl`. FLEURS's test tars
 * are streamed and cut off after the first utterances, so nothing near their 2.9 GB is downloaded. Audio stays in the
 * folder given, outside the repo. Attribution: FLEURS by Google (Conneau et al. 2022), CC-BY-4.0; HumynLabs
 * customer-support Hinglish audio, CC-BY-4.0.
 */
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { createGunzip } from 'node:zlib';
import { z } from 'zod';
import {
  FLEURS_LANGUAGES,
  HINGLISH_SETS,
  LANGUAGE_SET,
  LOCAL_CLIPS_FILE,
  localClipSchema,
  type LanguageClip,
} from './sets';

const run = promisify(execFile);
const HF = 'https://huggingface.co';
const AUDIO = /\.(wav|mp3|m4a|flac|ogg)$/i;

/** The first `count` .wav entries of a gzipped tar stream; the download stops once they are read. */
export async function firstTarEntries(url: string, count: number): Promise<{ name: string; data: Buffer }[]> {
  const abort = new AbortController();
  const response = await fetch(url, { signal: abort.signal, redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const source = Readable.fromWeb(response.body as never);
  // Stopping early aborts the download: that error is ours, not the server's.
  source.on('error', () => undefined);
  const gunzip = source.pipe(createGunzip());
  const entries: { name: string; data: Buffer }[] = [];
  let buffer = Buffer.alloc(0);
  try {
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 512) break;
        const header = buffer.subarray(0, 512);
        if (header.every((byte) => byte === 0)) return entries;
        const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
        const size = parseInt(
          header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0',
          8,
        );
        const padded = Math.ceil(size / 512) * 512;
        if (buffer.length < 512 + padded) break;
        if (name.endsWith('.wav'))
          entries.push({ name, data: Buffer.from(buffer.subarray(512, 512 + size)) });
        buffer = buffer.subarray(512 + padded);
        if (entries.length >= count) return entries;
      }
    }
    return entries;
  } finally {
    gunzip.destroy();
    source.destroy();
    abort.abort();
  }
}

async function download(url: string, out: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await writeFile(out, Buffer.from(await response.arrayBuffer()));
}

async function fleurs(dir: string, log: (line: string) => void): Promise<LanguageClip[]> {
  const clips: LanguageClip[] = [];
  for (const [code, language] of Object.entries(FLEURS_LANGUAGES)) {
    const folder = join(dir, 'clips', 'fleurs', code);
    await mkdir(folder, { recursive: true });
    const url = `${HF}/datasets/google/fleurs/resolve/main/data/${code}/audio/test.tar.gz`;
    const entries = await firstTarEntries(url, LANGUAGE_SET.perLanguage);
    for (const entry of entries) {
      const id =
        entry.name
          .split('/')
          .pop()
          ?.replace(/\.wav$/, '') ?? entry.name;
      const file = join(folder, `${id}.wav`);
      await writeFile(file, entry.data);
      clips.push({
        id: `fleurs/${code}/${id}`,
        set: 'fleurs',
        file: relative(dir, file),
        truth: { language },
      });
    }
    log(`FLEURS ${code}: ${entries.length}`);
  }
  return clips;
}

async function hinglish(dir: string, log: (line: string) => void): Promise<LanguageClip[]> {
  const clips: LanguageClip[] = [];
  for (const [index, repo] of HINGLISH_SETS.entries()) {
    const folder = join(dir, 'clips', 'hinglish', String(index));
    await mkdir(folder, { recursive: true });
    const tree = (await (await fetch(`${HF}/api/datasets/${repo}/tree/main`)).json()) as { path: string }[];
    const files = tree
      .map((entry) => entry.path)
      .filter((path) => AUDIO.test(path))
      .sort()
      .slice(0, LANGUAGE_SET.perSet);
    for (const [n, path] of files.entries()) {
      const ext = path.slice(path.lastIndexOf('.'));
      const file = join(folder, `${n}${ext}`);
      await download(`${HF}/datasets/${repo}/resolve/main/${encodeURIComponent(path)}`, file);
      clips.push({
        id: `hinglish/${index}/${n}`,
        set: 'hinglish',
        file: relative(dir, file),
        truth: { language: 'hi', mix: ['hi', 'en'] },
      });
    }
    log(`Hinglish ${repo}: ${files.length}`);
  }
  return clips;
}

/** One Hindi utterance then one English one, as one 16 kHz mono WAV. */
async function synthetic(dir: string, ffmpeg: string, fleursClips: readonly LanguageClip[]) {
  const of = (language: string) => fleursClips.filter((clip) => clip.truth.language === language);
  const [hindi, english] = [of('hi'), of('en')];
  const folder = join(dir, 'clips', 'synthetic');
  await mkdir(folder, { recursive: true });
  const clips: LanguageClip[] = [];
  for (let i = 0; i < Math.min(LANGUAGE_SET.synthetic, hindi.length, english.length); i++) {
    const [hi, en] = [hindi[i], english[i]];
    if (!hi || !en) continue;
    const file = join(folder, `${i}.wav`);
    await run(ffmpeg, [
      '-v', 'error', '-y', '-i', join(dir, hi.file), '-i', join(dir, en.file),
      '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1,aresample=16000,aformat=channel_layouts=mono',
      file,
    ]); // prettier-ignore
    clips.push({
      id: `synthetic/${i}`,
      set: 'synthetic',
      file: relative(dir, file),
      truth: { language: null, mix: ['hi', 'en'] },
      synthetic: true,
    });
  }
  return clips;
}

/** The local clips listed in `<ownerDir>/owner-clips.json`, copied in; none without the list. */
async function local(dir: string, ownerDir: string | undefined): Promise<LanguageClip[]> {
  const list = ownerDir ? join(ownerDir, LOCAL_CLIPS_FILE) : undefined;
  if (!list || !existsSync(list)) return [];
  const folder = join(dir, 'clips', 'owner');
  await mkdir(folder, { recursive: true });
  const clips: LanguageClip[] = [];
  for (const clip of z.array(localClipSchema).parse(JSON.parse(await readFile(list, 'utf8')))) {
    const source = join(ownerDir ?? '', clip.file);
    if (!existsSync(source)) continue;
    const file = join(folder, basename(clip.file));
    await copyFile(source, file);
    clips.push({
      id: `owner/${clip.name}`,
      set: 'owner',
      file: relative(dir, file),
      truth: clip.truth ?? { language: null },
      name: clip.name,
      ...(clip.truth ? {} : { unlabelled: true }),
    });
  }
  return clips;
}

export async function fetchLanguageSet(options: {
  readonly dir: string;
  readonly ffmpeg: string;
  readonly ownerDir?: string;
  readonly log?: (line: string) => void;
}): Promise<LanguageClip[]> {
  const log = options.log ?? (() => undefined);
  await mkdir(options.dir, { recursive: true });
  const read = await fleurs(options.dir, log);
  const clips = [
    ...read,
    ...(await hinglish(options.dir, log)),
    ...(await synthetic(options.dir, options.ffmpeg, read)),
    ...(await local(options.dir, options.ownerDir)),
  ];
  await writeFile(
    join(options.dir, 'clips.jsonl'),
    clips.map((clip) => JSON.stringify(clip)).join('\n') + '\n',
  );
  log(`${clips.length} clips in ${join(options.dir, 'clips.jsonl')}`);
  return clips;
}
