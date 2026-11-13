// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the find eval's library folder from `clips.json`: each Commons file is downloaded once into
 * `originals/` (kept, and checked by its SHA-1 on every run), then cut to its window and encoded the way a phone
 * clip looks to the app: H.264 through the platform's software encoder, 30 fps, the longer side at most 1280,
 * no sound. A local owner set's clips are copied unchanged from `--owner`, so their phone tags stay. `manifest.json` lists
 * every clip with its id, in the search eval's manifest format (`adapters/search.ts`).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { softwareEncoderFor, videoEncodeFlags } from '@taalcut/media';
import { writeJson } from '../../files';
import { runFfmpeg } from '../../ffmpeg-run';
import type { ClipFile, CommonsClip, OwnerClip } from './schema';

/** Wikimedia asks every client to say who it is. */
const USER_AGENT = 'TaalcutEval/1 (search eval fetcher; https://github.com/taalcut)';

export const FIND_LIBRARY = 'lib1-find';

export interface ManifestClip {
  readonly id: string;
  /** Path inside the library folder. */
  readonly asset: string;
}

export interface FindManifest {
  readonly library: typeof FIND_LIBRARY;
  readonly clips: readonly ManifestClip[];
}

export interface FetchOptions {
  readonly clips: ClipFile;
  readonly out: string;
  readonly ffmpeg: string;
  readonly ffprobe: string;
  /** The local owner set's clips and the folder holding them by file name; absent: Commons clips only. */
  readonly owner?: { readonly dir: string; readonly clips: readonly OwnerClip[] };
  /** Tests: fetch through this. */
  readonly fetch?: typeof fetch;
  readonly log: (line: string) => void;
}

/**
 * A Commons clip's path: a five-digit number from its SHA-1, as a phone names a file.
 * Its id would name the answer ("dance-rabha.mp4"), and search reads file names.
 */
export const commonsAsset = (clip: Pick<CommonsClip, 'sha1'>) =>
  `commons/${10_000 + (Number.parseInt(clip.sha1.slice(0, 8), 16) % 90_000)}.mp4`;
export const ownerAsset = (clip: Pick<OwnerClip, 'file'>) => `owner/${clip.file}`;

const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex');

/** The original's file name: its id and the extension of its URL's path. */
export function originalName(clip: Pick<CommonsClip, 'id' | 'url'>): string {
  return `${clip.id}${extname(new URL(clip.url).pathname) || '.webm'}`;
}

async function original(clip: CommonsClip, dir: string, options: FetchOptions): Promise<string> {
  const path = join(dir, originalName(clip));
  if (existsSync(path) && sha1(readFileSync(path)) === clip.sha1) return path;
  options.log(`fetching ${clip.id} (${(clip.bytes / 1e6).toFixed(1)} MB)`);
  const response = await (options.fetch ?? fetch)(clip.url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${clip.id}: ${clip.url} answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const got = sha1(bytes);
  if (got !== clip.sha1) throw new Error(`${clip.id}: SHA-1 ${got}, clips.json says ${clip.sha1}`);
  writeFileSync(path, bytes);
  return path;
}

/** Transfer curves FFmpeg names for HDR: HLG and PQ. */
const HDR_TRANSFERS = new Set(['arib-std-b67', 'smpte2084']);

/** Tone-maps an HDR source to BT.709 (Hable), so every clip is plain SDR the way most phone exports are. */
const TONE_MAP =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,';

/**
 * FFmpeg's arguments for one clip's window: software H.264, tagged BT.709, sound and metadata dropped. Keep the
 * generated clips for comparisons: encoder output may differ across OS versions. An
 * HDR source (`hdr`) is tone-mapped first: 8-bit HLG left tagged as HLG fails the app's shot detection (its HDR
 * read asks for 10-bit frames), a finding of its own, not what this eval measures.
 */
export function encodeArgs(
  source: string,
  clip: Pick<CommonsClip, 'start' | 'seconds'>,
  out: string,
  hdr = false,
): string[] {
  const scale = "scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))'";
  return [
    ...[
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-ss',
      String(clip.start),
      '-i',
      source,
      '-t',
      String(clip.seconds),
    ],
    ...['-map', '0:v:0', '-an', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact'],
    ...['-vf', `${hdr ? TONE_MAP : ''}fps=30,${scale},format=yuv420p`],
    ...['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'],
    ...videoEncodeFlags(softwareEncoderFor('h264')!, 4_000_000, 60),
    ...['-movflags', '+faststart', out],
  ];
}

/** Whether the source's first video stream is HDR (HLG or PQ), by ffprobe. */
async function isHdr(ffprobe: string, source: string): Promise<boolean> {
  const out = await runFfmpeg(ffprobe, [
    ...['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_transfer'],
    ...['-of', 'default=noprint_wrappers=1:nokey=1', source],
  ]);
  return HDR_TRANSFERS.has(out.toString('utf8').trim());
}

export async function fetchFindLibrary(options: FetchOptions): Promise<FindManifest> {
  const originals = join(options.out, 'originals');
  mkdirSync(originals, { recursive: true });
  mkdirSync(join(options.out, 'commons'), { recursive: true });
  const clips: ManifestClip[] = [];
  for (const clip of options.clips.clips) {
    const source = await original(clip, originals, options);
    const asset = commonsAsset(clip);
    const out = join(options.out, asset);
    if (!existsSync(out))
      await runFfmpeg(options.ffmpeg, encodeArgs(source, clip, out, await isHdr(options.ffprobe, source)));
    clips.push({ id: clip.id, asset });
  }
  if (options.owner) {
    mkdirSync(join(options.out, 'owner'), { recursive: true });
    for (const clip of options.owner.clips) {
      const from = join(options.owner.dir, clip.file);
      if (!existsSync(from)) throw new Error(`--owner ${options.owner.dir} has no ${clip.file}`);
      copyFileSync(from, join(options.out, ownerAsset(clip)));
      clips.push({ id: clip.id, asset: ownerAsset(clip) });
    }
  }
  const manifest: FindManifest = { library: FIND_LIBRARY, clips };
  writeJson(join(options.out, 'manifest.json'), manifest);
  options.log(`${clips.length} clips in ${options.out}${options.owner ? ', the owner set’s included' : ''}`);
  return manifest;
}
