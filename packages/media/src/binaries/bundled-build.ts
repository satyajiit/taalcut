// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The in-house FFmpeg build (tools/ffmpeg): `BUILDINFO.json` next to the
 * binaries records what was built (version, licence, configure line, output
 * hashes). The resolver checks the binaries against it before any media work
 * runs, so a stray or swapped binary is refused rather than used.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { bundleFiles, FFMPEG_BUILD_TARGETS, type FfmpegBuildTarget } from './build-targets';

/** The macOS FFmpeg release the app is built and tested against (tools/ffmpeg/versions.env). Per platform: build-targets.ts. */
export const BUNDLED_FFMPEG_VERSION = FFMPEG_BUILD_TARGETS['darwin-arm64'].version;
export const BUILDINFO_FILE = 'BUILDINFO.json';
/** MoltenVK's Vulkan ICD, relative to the macOS binaries' folder; `library_path` in it is `./libMoltenVK.dylib`. */
export const MOLTENVK_ICD = join('lib', 'MoltenVK_icd.json');

/**
 * Why a bundled build was refused:
 * - no_buildinfo / buildinfo_invalid: BUILDINFO.json missing or unreadable;
 * - licence: not LGPL (BUILDINFO, `-L`, or a configure flag says GPL or nonfree);
 * - version: not the expected FFmpeg release, or a binary that reports another version;
 * - configuration: a binary built with other configure flags than BUILDINFO records;
 * - checksum: a file whose sha256 is not the one BUILDINFO records.
 */
export type BuildMismatchReason =
  'no_buildinfo' | 'buildinfo_invalid' | 'licence' | 'version' | 'configuration' | 'checksum';

export interface BundledBuild {
  readonly version: string;
  readonly licence: string;
  /** The configure flags, split as `-version` prints them. */
  readonly configure: readonly string[];
  /** sha256 by output name: ffmpeg, ffprobe, the shared libraries, MoltenVK_icd.json, libMoltenVK.dylib. */
  readonly sha256: Readonly<Record<string, string>>;
}

export interface BuildMismatch {
  readonly reason: BuildMismatchReason;
  readonly detail: string;
}

const buildInfoSchema = z.object({
  ffmpeg_version: z.string().min(1),
  license: z.string().min(1),
  gpl: z.boolean(),
  nonfree: z.boolean(),
  configure: z.string(),
  outputs: z.array(z.object({ name: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/) })),
});

export const splitConfigure = (configure: string): string[] => configure.split(/\s+/).filter(Boolean);

/**
 * Reads `dir/BUILDINFO.json` and checks what it declares (licence and version).
 * Nothing is run: this comes before any binary in `dir` is spawned.
 * `fileSha256` is the file's own hash, for a build pinned in the app.
 */
export async function readBundledBuild(
  dir: string,
  expectedVersion: string,
): Promise<{ ok: true; build: BundledBuild; fileSha256: string } | { ok: false; mismatch: BuildMismatch }> {
  const path = join(dir, BUILDINFO_FILE);
  let json: unknown;
  let fileSha256: string;
  try {
    const bytes = await readFile(path);
    fileSha256 = createHash('sha256').update(bytes).digest('hex');
    json = JSON.parse(bytes.toString('utf8'));
  } catch (cause) {
    const missing = cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';
    const reason = missing ? 'no_buildinfo' : 'buildinfo_invalid';
    return { ok: false, mismatch: { reason, detail: `${path}: ${missing ? 'missing' : String(cause)}` } };
  }
  const parsed = buildInfoSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      mismatch: { reason: 'buildinfo_invalid', detail: `${path}: ${parsed.error.message}` },
    };
  }
  const info = parsed.data;
  const configure = splitConfigure(info.configure);
  const gplFlags = configure.filter((flag) => flag === '--enable-gpl' || flag === '--enable-nonfree');
  if (!info.license.startsWith('LGPL-') || info.gpl || info.nonfree || gplFlags.length > 0) {
    const detail = `${path}: license ${info.license}, gpl ${info.gpl}, nonfree ${info.nonfree} ${gplFlags.join(' ')}`;
    return { ok: false, mismatch: { reason: 'licence', detail: detail.trim() } };
  }
  if (info.ffmpeg_version !== expectedVersion) {
    const detail = `${path}: FFmpeg ${info.ffmpeg_version}, expected ${expectedVersion}`;
    return { ok: false, mismatch: { reason: 'version', detail } };
  }
  const sha256 = Object.fromEntries(info.outputs.map((output) => [output.name, output.sha256]));
  const build = { version: info.ffmpeg_version, licence: info.license, configure, sha256 };
  return { ok: true, build, fileSha256 };
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** The first file in `dir` whose sha256 differs from BUILDINFO's, or undefined when all match. */
export async function findChecksumMismatch(
  dir: string,
  build: BundledBuild,
  target: FfmpegBuildTarget,
  withVulkan: boolean,
): Promise<string | undefined> {
  for (const [name, relative] of bundleFiles(target, withVulkan)) {
    const expected = build.sha256[name];
    const actual = await sha256File(join(dir, relative));
    if (expected !== actual) return `${relative}: sha256 ${actual}, BUILDINFO says ${expected ?? 'nothing'}`;
  }
  return undefined;
}

/**
 * The bundled Vulkan ICD (`dir/lib/MoltenVK_icd.json` on macOS) when it and the library it names are there.
 * Undefined where the target ships none: libplacebo then uses the system loader.
 */
export async function findVulkanIcd(dir: string, target: FfmpegBuildTarget): Promise<string | undefined> {
  if (!target.vulkan) return undefined;
  try {
    await access(join(dir, target.vulkan.icd[1]));
    await access(join(dir, target.vulkan.library[1]));
    return join(dir, target.vulkan.icd[1]);
  } catch {
    return undefined;
  }
}
