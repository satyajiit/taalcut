// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The capture files in main's captures folder: `<id>.wav.part` while recording (a zeroed WAV header, then the
 * PCM), `<id>.wav` once finished. The folder is 0700 and every file 0600. Throws Node's errors; the store turns
 * them into error values.
 */
import { appendFile, chmod, mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256File } from '@taalcut/jobs';
import { WAV_HEADER_BYTES } from './wav-header';

/** Names main writes: a capture id, then `.wav` or `.wav.part`. */
const CAPTURE_FILE = /^[0-9A-HJKMNP-TV-Z]{26}\.wav(\.part)?$/;

const isMissing = (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';

export interface CaptureFile {
  readonly id: string;
  readonly path: string;
  readonly modifiedAt: number;
}

export interface CaptureFiles {
  /** Makes the folder (0700). */
  prepare(): Promise<void>;
  begin(id: string): Promise<void>;
  append(id: string, pcm: Buffer): Promise<void>;
  /** Writes the header over the zeroed one and renames the file to `<id>.wav`; returns its path. */
  finish(id: string, header: Buffer): Promise<string>;
  remove(id: string): Promise<void>;
  finishedPath(id: string): string;
  /** Every capture file in the folder, with its id and modification time. */
  list(): Promise<CaptureFile[]>;
  sha256(path: string): Promise<string>;
}

export function createCaptureFiles(dir: string): CaptureFiles {
  const partPath = (id: string) => join(dir, `${id}.wav.part`);
  const finishedPath = (id: string) => join(dir, `${id}.wav`);
  return {
    async prepare() {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
    },
    begin: (id) => writeFile(partPath(id), Buffer.alloc(WAV_HEADER_BYTES), { mode: 0o600, flag: 'wx' }),
    append: (id, pcm) => appendFile(partPath(id), pcm),
    async finish(id, header) {
      const file = await open(partPath(id), 'r+');
      try {
        await file.write(header, 0, header.length, 0);
      } finally {
        await file.close();
      }
      await rename(partPath(id), finishedPath(id));
      return finishedPath(id);
    },
    async remove(id) {
      await Promise.all([rm(partPath(id), { force: true }), rm(finishedPath(id), { force: true })]);
    },
    finishedPath,
    async list() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (cause) {
        if (isMissing(cause)) return [];
        throw cause;
      }
      const files: CaptureFile[] = [];
      for (const name of names.filter((n) => CAPTURE_FILE.test(n))) {
        const path = join(dir, name);
        files.push({ id: name.slice(0, 26), path, modifiedAt: (await stat(path)).mtimeMs });
      }
      return files;
    },
    sha256: (path) => sha256File(path),
  };
}
