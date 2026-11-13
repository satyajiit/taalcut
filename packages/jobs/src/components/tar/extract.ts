// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Safe extraction of a tar, tar.gz or tar.zst archive into an empty folder,
 * with Node built-ins only.
 *
 * Safety rules (an archive is untrusted even with a good checksum, because the
 * manifest could be wrong): no absolute paths, no '..', no backslashes; no
 * hard links, devices or FIFOs; symlinks must be relative and are created only
 * after every file is written; once they all exist, each is followed through
 * any other links and must stay inside the folder; nothing is ever made or
 * written through a link (paths.ts); regular files may not add up to more
 * than the manifest's extractedSize (a decompression bomb stops early); modes
 * are 755 or 644, never setuid.
 */
import { createReadStream } from 'node:fs';
import { realpath, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createZstdDecompress } from 'node:zlib';
import { writeAll } from '../fs-util';
import type { ArchiveFormat } from '../manifest';
import { ByteReader, TarError } from './byte-reader';
import { BLOCK_SIZE, isZeroBlock, paddedSize, parseHeader, parsePax, readString } from './header';
import { checkLinkStaysInside, isInside, makeRealDir, openNoFollow } from './paths';

export { isInside } from './paths';

export interface ExtractOptions {
  readonly format: ArchiveFormat;
  readonly stripComponents: number;
  /** Hard cap on the total size of regular files. */
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
  /** Bytes of the (compressed) archive read so far. */
  readonly onProgress?: (archiveBytesRead: number) => void;
}

export interface ExtractSummary {
  readonly files: number;
  readonly directories: number;
  readonly symlinks: number;
  /** Total size of the regular files written. */
  readonly bytes: number;
}

/** PAX and GNU long-name blocks are metadata; anything bigger than this is not a real archive. */
const MAX_METADATA_BYTES = 1024 * 1024;

/**
 * Extracts `archivePath` into `destDir` (which must exist). Throws TarError for
 * a corrupt or unsafe archive, zlib errors for bad compression, AbortError on
 * cancel, and plain fs errors otherwise; the caller maps them to TaalcutErrors.
 */
export async function extractTar(
  archivePath: string,
  destDir: string,
  options: ExtractOptions,
): Promise<ExtractSummary> {
  const root = await realpath(destDir);
  const input = createReadStream(archivePath, { highWaterMark: 1024 * 1024 });
  let summary: ExtractSummary | undefined;
  const consume = async (source: AsyncIterable<Uint8Array>) => {
    summary = await new Extraction(root, options, () => input.bytesRead).run(new ByteReader(source));
  };
  const signal = options.signal ? { signal: options.signal } : {};
  if (options.format === 'tar') await pipeline(input, consume, signal);
  else if (options.format === 'tar.gz') await pipeline(input, createGunzip(), consume, signal);
  else await pipeline(input, createZstdDecompress(), consume, signal);
  return summary!;
}

class Extraction {
  private files = 0;
  private directories = 0;
  private bytes = 0;
  private readonly links: { path: string; target: string }[] = [];
  private readonly madeDirs = new Set<string>();

  constructor(
    private readonly root: string,
    private readonly options: ExtractOptions,
    private readonly bytesRead: () => number,
  ) {
    this.madeDirs.add(root);
  }

  async run(reader: ByteReader): Promise<ExtractSummary> {
    let pax: Record<string, string> = {};
    let longName: string | undefined;
    let longLink: string | undefined;
    for (;;) {
      const block = await reader.read(BLOCK_SIZE);
      if (!block || isZeroBlock(block)) break;
      const header = parseHeader(block);
      if (header.type === 'pax' || header.type === 'gnu-longname' || header.type === 'gnu-longlink') {
        const data = await readMetadata(reader, header.size);
        if (header.type === 'pax') pax = { ...pax, ...parsePax(data) };
        else if (header.type === 'gnu-longname') longName = readString(data, 0, data.length);
        else longLink = readString(data, 0, data.length);
        continue;
      }
      const size = pax.size !== undefined ? parsePaxSize(pax.size) : header.size;
      const name = pax.path ?? longName ?? header.name;
      const linkName = pax.linkpath ?? longLink ?? header.linkName;
      pax = {};
      longName = longLink = undefined;
      if (header.type === 'pax-global') {
        await reader.skip(paddedSize(size));
        continue;
      }
      const segments = safeSegments(name, this.options.stripComponents);
      const path = segments ? join(this.root, ...segments) : undefined;
      if (header.type === 'file') {
        if (path) await this.writeFile(reader, path, size, header.mode);
        else await reader.skip(paddedSize(size));
      } else if (header.type === 'directory') {
        if (path) await this.ensureDir(path, true);
        await reader.skip(paddedSize(size));
      } else if (header.type === 'symlink') {
        if (path) this.links.push({ path, target: linkName });
        await reader.skip(paddedSize(size));
      } else {
        throw new TarError(`unsupported tar entry type '${header.typeFlag}' for '${name}'`);
      }
    }
    await reader.drain();
    for (const link of this.links) await this.createLink(link.path, link.target);
    // Only now is every link in place: a target can lead through links that came later in the archive.
    for (const link of this.links) await checkLinkStaysInside(this.root, link.path);
    return {
      files: this.files,
      directories: this.directories,
      symlinks: this.links.length,
      bytes: this.bytes,
    };
  }

  private async writeFile(reader: ByteReader, path: string, size: number, mode: number): Promise<void> {
    this.bytes += size;
    if (this.bytes > this.options.maxBytes) {
      throw new TarError(`archive holds more than the ${this.options.maxBytes} bytes the manifest declares`);
    }
    await this.ensureDir(dirname(path), false);
    const fileMode = mode & 0o111 ? 0o755 : 0o644;
    const handle = await openNoFollow(this.root, path, fileMode);
    try {
      await handle.chmod(fileMode);
      for await (const piece of reader.stream(size)) {
        await writeAll(handle, piece);
        this.options.onProgress?.(this.bytesRead());
      }
    } finally {
      await handle.close();
    }
    await reader.skip(paddedSize(size) - size);
    this.files += 1;
  }

  /**
   * Makes `path` and its missing parents one level at a time from the root,
   * so a link anywhere on the way is refused instead of followed (paths.ts).
   * `madeDirs` holds folders already known to be real.
   */
  private async ensureDir(path: string, counted: boolean): Promise<void> {
    if (this.madeDirs.has(path)) return;
    const parent = dirname(path);
    if (parent === path || !isInside(this.root, parent)) {
      throw new TarError(`'${path}' is outside the component folder`);
    }
    await this.ensureDir(parent, false);
    await makeRealDir(this.root, path);
    this.madeDirs.add(path);
    if (counted) this.directories += 1;
  }

  private async createLink(path: string, target: string): Promise<void> {
    if (target === '' || isAbsolute(target) || target.includes('\0')) {
      throw new TarError(`unsafe symlink target '${target}'`);
    }
    const parent = dirname(path);
    await this.ensureDir(parent, false); // refuses a parent that is, or sits under, an earlier link
    if (!isInside(this.root, resolve(parent, target))) {
      throw new TarError(`symlink '${relative(this.root, path)}' points outside the component folder`);
    }
    await symlink(target, path);
  }
}

/** Path segments to extract to, undefined when stripComponents removes the whole path. Throws if unsafe. */
export function safeSegments(name: string, stripComponents: number): string[] | undefined {
  if (name.includes('\0') || name.includes('\\') || name.startsWith('/')) {
    throw new TarError(`unsafe path '${name}' in archive`);
  }
  const segments = name.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) throw new TarError(`unsafe path '${name}' in archive`);
  const kept = segments.slice(stripComponents);
  return kept.length > 0 ? kept : undefined;
}

async function readMetadata(reader: ByteReader, size: number): Promise<Buffer> {
  if (size > MAX_METADATA_BYTES) throw new TarError('tar metadata block is too large');
  const data = size > 0 ? await reader.read(size) : Buffer.alloc(0);
  if (!data) throw new TarError('unexpected end of archive');
  await reader.skip(paddedSize(size) - size);
  return data;
}

function parsePaxSize(value: string): number {
  if (!/^\d+$/.test(value)) throw new TarError(`bad PAX size '${value}'`);
  const size = Number(value);
  if (!Number.isSafeInteger(size)) throw new TarError('PAX size is too large');
  return size;
}
