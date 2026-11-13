// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * 1,000 phone files from a handful of bundled-FFmpeg encodes, with no process per file. Each kind of file has a
 * template: a video encoded once and stream-copied once with placeholders in its metadata (its comment; a Live
 * Photo's content identifier), a JPEG with a COM marker (stream-copy drops comments), a HEIC from `sips` with a
 * trailing `free` box. Off a Mac (LNX1-PKG) H.264 is the build's libopenh264 where it lists no VideoToolbox. The
 * bundled FFmpeg has no CPU HEVC encoder, on Linux as on the Mac (libx265 is GPL; LNX1-FFB), so there the HEVC
 * template is stream-copied from `hevc-192x144.mov` beside this file, and the HEIC is its first frame in a HEIF of our
 * own (heic-still.ts). A file is its template with each placeholder overwritten by its name (and group), which is
 * the same length, so nothing else in the file moves. (Each file used to be its own FFmpeg run, and the import and
 * the check then ran ffprobe on each: about 2,900 processes, which on the shared Mac, where starting one can take
 * seconds, ran past the test's 5 minutes. UX2 round 2.)
 *
 * What ffprobe says of a file is what it says of its template with the same overwrite (`probeOf`): the catalogue
 * probes each template once; the test checks that against ffprobe on a sample of the files themselves.
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseEncoders, type ProbeResult } from '@taalcut/media';
import type { TransferMedia } from '../../src/deps';
import type { DeviceItem, DeviceItemFlags } from '../../src/usb/bridge';
import type { ListedFile } from './fake-phone';
import { heicFromHevc } from './heic-still';

const exec = promisify(execFile);

export type Role = 'h264' | 'hevc' | 'prores' | 'slow' | 'jpeg' | 'heic' | 'live-still' | 'live-mov';

interface Job {
  readonly role: Role;
  readonly name: string;
  readonly createdAt: number;
  readonly group?: string;
}

interface Template {
  readonly bytes: Buffer;
  readonly probe: ProbeResult;
}

export interface Catalogue {
  readonly files: readonly ListedFile[];
  /** The kind of each file, by name. */
  readonly roles: ReadonlyMap<string, Role>;
  /** ffprobe's answer for `bytes` read from `path` (symlinks resolved, as ffprobe reports it); undefined for bytes
   * the catalogue didn't make. */
  probeOf(path: string, bytes: Buffer): ProbeResult | undefined;
}

/** The placeholder a name of `role` overwrites: the name with its counter as ####, so the same length. */
const namePlaceholder = (name: string) => name.replace(/\d{4}/, '####');
const GROUP_PLACEHOLDER = 'LIVE-####';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** macOS's image tool, which writes the HEIC an iPhone would; elsewhere heic-still.ts does. */
const SIPS = '/usr/bin/sips';
/**
 * Two 192×144 HEVC Main frames in a MOV (`hvc1`), for a build without VideoToolbox: the hardware encoders it might
 * have refuse anything under 128 pixels, and a machine without a GPU (CI) has none. Made once with the Linux build:
 * `ffmpeg -init_hw_device vaapi=va:/dev/dri/renderD128 -filter_hw_device va -f lavfi -i
 * testsrc=size=192x144:rate=24:duration=0.08 -vf format=nv12,hwupload -c:v hevc_vaapi -profile:v main -tag:v hvc1
 * -an -map_metadata -1 -bitexact -fflags +bitexact -flags:v +bitexact hevc-192x144.mov`.
 */
const HEVC_FIXTURE = fileURLToPath(new URL('./hevc-192x144.mov', import.meta.url));
const HEVC_FIXTURE_SIZE = { width: 192, height: 144 } as const;

/**
 * The first of `names` the build lists, for each codec: VideoToolbox on a Mac, libopenh264 elsewhere. HEVC is
 * VideoToolbox or nothing (undefined: the fixture).
 */
async function pickEncoders(ffmpeg: string): Promise<{ readonly h264: string; readonly hevc?: string }> {
  const { stdout } = await exec(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 30_000 });
  const listed = new Set(parseEncoders(stdout).map((encoder) => encoder.name));
  const first = (...names: string[]) => {
    const found = names.find((name) => listed.has(name));
    if (!found) throw new Error(`the bundled FFmpeg has none of ${names.join(', ')}`);
    return found;
  };
  return {
    h264: first('h264_videotoolbox', 'libopenh264'),
    hevc: listed.has('hevc_videotoolbox') ? 'hevc_videotoolbox' : undefined,
  };
}

export async function buildCatalogue(
  dir: string,
  ffmpeg: string,
  probe: TransferMedia['probe'],
): Promise<Catalogue> {
  await mkdir(dir, { recursive: true });
  const templates = await makeTemplates(dir, ffmpeg, probe);
  const files: ListedFile[] = [];
  const roles = new Map<string, Role>();
  const byHash = new Map<string, { role: Role; swaps: readonly (readonly [string, string])[] }>();
  for (const job of planJobs()) {
    const template = templates.get(job.role);
    if (!template) throw new Error(`no ${job.role} template`);
    const swaps: [string, string][] = [[namePlaceholder(job.name), job.name]];
    // The video of a Live Photo carries its group; the still only lists it.
    if (job.group && job.role === 'live-mov') swaps.push([GROUP_PLACEHOLDER, job.group]);
    const bytes = swaps.reduce((current, [from, to]) => overwrite(current, from, to), template.bytes);
    files.push({ bytes, item: toItem(job, bytes.length, template.probe) });
    roles.set(job.name, job.role);
    byHash.set(sha256(bytes), { role: job.role, swaps });
  }
  return {
    files,
    roles,
    probeOf(path, bytes) {
      const made = byHash.get(sha256(bytes));
      const template = made && templates.get(made.role);
      if (!made || !template) return undefined;
      let text = JSON.stringify(template.probe);
      for (const [from, to] of made.swaps) text = text.replaceAll(from, to);
      return { ...(JSON.parse(text) as ProbeResult), path };
    },
  };
}

/** `bytes` with every `from` overwritten by `to`, which is the same length; `from` must be there. */
function overwrite(bytes: Buffer, from: string, to: string): Buffer {
  const target = Buffer.from(from, 'utf8');
  const value = Buffer.from(to, 'utf8');
  if (target.length !== value.length) throw new Error(`${to} is not the length of ${from}`);
  const out = Buffer.from(bytes);
  let found = 0;
  for (let at = out.indexOf(target); at >= 0; at = out.indexOf(target, at + target.length)) {
    value.copy(out, at);
    found += 1;
  }
  if (found === 0) throw new Error(`no ${from} in the template`);
  return out;
}

/** One file per kind, with its placeholders; then each is probed once. */
async function makeTemplates(
  dir: string,
  ffmpeg: string,
  probe: TransferMedia['probe'],
): Promise<Map<Role, Template>> {
  const run = (args: readonly string[]) =>
    exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { timeout: 30_000 });
  const lavfi = (source: string) => ['-f', 'lavfi', '-i', source];
  const encoders = await pickEncoders(ffmpeg);
  const h264 = ['-c:v', encoders.h264, '-pix_fmt', 'yuv420p', '-an'];
  const bases = {
    h264: [...lavfi('testsrc=size=64x48:rate=30:duration=0.1'), ...h264],
    hevc: encoders.hevc
      ? [
          ...lavfi('testsrc=size=64x48:rate=24:duration=0.08'),
          ...['-c:v', encoders.hevc, '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-an'],
        ]
      : ['-i', HEVC_FIXTURE, '-c', 'copy', '-an'],
    prores: [
      ...lavfi('testsrc=size=64x48:rate=24:duration=0.08'),
      ...['-c:v', 'prores_ks', '-profile:v', '0', '-pix_fmt', 'yuv422p10le', '-an'],
    ],
    slow: [...lavfi('testsrc=size=64x48:rate=120:duration=0.05'), ...h264],
  } as const;
  const paths = new Map<Role, string>();
  for (const [role, args] of Object.entries(bases) as [keyof typeof bases, readonly string[]][]) {
    const base = join(dir, `base-${role}.mov`);
    await run([...args, base]);
    const template = join(dir, `template-${role}.mov`);
    await run(['-i', base, '-c', 'copy', '-metadata', `comment=${role}-####.mov`, template]);
    paths.set(role, template);
  }
  const live = join(dir, 'template-live.mov');
  await run([
    ...['-i', join(dir, 'base-h264.mov'), '-c', 'copy', '-metadata', 'comment=live-####.mov'],
    ...['-movflags', 'use_metadata_tags'],
    ...['-metadata', `com.apple.quicktime.content.identifier=${GROUP_PLACEHOLDER}`, live],
  ]);
  paths.set('live-mov', live);
  const jpeg = join(dir, 'base.jpg');
  await run([
    ...lavfi('testsrc=size=64x48:rate=1:duration=1'),
    '-frames:v',
    '1',
    '-c:v',
    'mjpeg',
    '-q:v',
    '3',
    jpeg,
  ]);
  const heic = join(dir, 'base.heic');
  if (existsSync(SIPS)) await exec(SIPS, ['-s', 'format', 'heic', jpeg, '--out', heic]);
  else {
    const frame = join(dir, 'base.hevc');
    await run(['-i', HEVC_FIXTURE, '-frames:v', '1', '-c', 'copy', '-f', 'hevc', frame]);
    await writeFile(
      heic,
      heicFromHevc(await readFile(frame), HEVC_FIXTURE_SIZE.width, HEVC_FIXTURE_SIZE.height),
    );
  }
  const jpegBytes = await readFile(jpeg);
  const made: [Role, Buffer][] = [
    ['jpeg', withJpegComment(jpegBytes, 'jpeg-####.jpg')],
    ['live-still', withJpegComment(jpegBytes, 'live-####.jpg')],
    ['heic', withFreeBox(await readFile(heic), 'heic-####.heic')],
  ];
  for (const [role, bytes] of made) {
    const path = join(dir, `template-${role}${role === 'heic' ? '.heic' : '.jpg'}`);
    await writeFile(path, bytes);
    paths.set(role, path);
  }
  const templates = new Map<Role, Template>();
  for (const [role, path] of paths) {
    const probed = await probe(path);
    if (!isProbe(probed) || !probed.video) throw new Error(`probe failed for ${path}`);
    templates.set(role, { bytes: await readFile(path), probe: probed });
  }
  return templates;
}

function planJobs(): Job[] {
  const jobs: Job[] = [];
  const add = (role: Role, count: number, ext: string): void => {
    for (let index = 0; index < count; index += 1) {
      const n = jobs.length;
      jobs.push({
        role,
        name: `${role}-${String(n).padStart(4, '0')}.${ext}`,
        createdAt: 1_700_000_000_000 + n * 1000,
      });
    }
  };
  add('h264', 250, 'mov');
  add('hevc', 200, 'mov');
  add('prores', 100, 'mov');
  add('slow', 100, 'mov');
  add('jpeg', 100, 'jpg');
  add('heic', 50, 'heic');
  for (let index = 0; index < 100; index += 1) {
    const group = `LIVE-${String(index).padStart(4, '0')}`;
    const at = 1_700_000_000_000 + (jobs.length + 1) * 1000;
    const name = `live-${String(index).padStart(4, '0')}`;
    jobs.push({ role: 'live-still', name: `${name}.jpg`, createdAt: at, group });
    jobs.push({ role: 'live-mov', name: `${name}.mov`, createdAt: at, group });
  }
  if (jobs.length !== 1000) throw new Error(`planned ${jobs.length} files`);
  return jobs;
}

function withJpegComment(jpeg: Buffer, text: string): Buffer {
  const comment = Buffer.from(text, 'utf8');
  const marker = Buffer.alloc(4 + comment.length);
  marker[0] = 0xff;
  marker[1] = 0xfe;
  marker.writeUInt16BE(2 + comment.length, 2);
  comment.copy(marker, 4);
  const end = jpeg.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (end < 0) return Buffer.concat([jpeg, marker, randomBytes(2)]);
  return Buffer.concat([jpeg.subarray(0, end), marker, jpeg.subarray(end)]);
}

/** A HEIC (an ISO BMFF file) with a top-level `free` box holding `text` at the end, which readers skip. */
function withFreeBox(heic: Buffer, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const box = Buffer.alloc(8 + payload.length);
  box.writeUInt32BE(box.length, 0);
  box.write('free', 4, 'ascii');
  payload.copy(box, 8);
  return Buffer.concat([heic, box]);
}

function toItem(job: Job, sizeBytes: number, probe: ProbeResult): DeviceItem {
  const still = job.role === 'jpeg' || job.role === 'heic' || job.role === 'live-still';
  const duration = probe.duration;
  const durationMs =
    !still && duration && duration.rate !== 0 ? Math.round((duration.value / duration.rate) * 1000) : null;
  return {
    id: job.name,
    name: job.name,
    kind: still ? 'image' : 'video',
    sizeBytes,
    createdAt: job.createdAt,
    modifiedAt: job.createdAt,
    width: probe.video?.width ?? null,
    height: probe.video?.height ?? null,
    durationMs,
    type: mime(job.role),
    folder: null,
    album: null,
    flags: flags(job),
    sidecars: [],
    availability: 'local',
  };
}

function mime(role: Role): string {
  if (role === 'hevc') return 'video/quicktime; codecs=hevc';
  if (role === 'heic') return 'image/heic';
  if (role === 'jpeg' || role === 'live-still') return 'image/jpeg';
  return 'video/quicktime';
}

function flags(job: Job): DeviceItemFlags {
  if (job.role === 'prores') return { prores: true };
  if (job.role === 'slow') return { highFrameRate: true };
  if (job.group) return { livePhotoGroup: job.group };
  return {};
}

export function isProbe(value: Awaited<ReturnType<TransferMedia['probe']>>): value is ProbeResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'container' in value &&
    'streams' in value &&
    'video' in value
  );
}
