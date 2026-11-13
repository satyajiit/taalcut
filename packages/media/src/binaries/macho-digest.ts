// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A sha256 of a sidecar that survives code signing. Packaging re-signs
 * ffmpeg, ffprobe and libMoltenVK with the app's identity, which replaces the
 * signature blob at the end of `__LINKEDIT` and rewrites three size fields;
 * nothing else in the file changes. So for a thin 64-bit Mach-O this hashes
 * the bytes before the signature (`LC_CODE_SIGNATURE.dataoff`) with those
 * fields zeroed: `LC_CODE_SIGNATURE.datasize` and `__LINKEDIT`'s `vmsize` and
 * `filesize`. Every byte the kernel maps or dyld reads is still covered,
 * including where the signature starts. Any other file (the ICD, a fat
 * binary, a script) is hashed whole.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const MH_MAGIC_64 = 0xfeedfacf;
const HEADER_SIZE = 32;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;

export async function signatureFreeSha256(path: string): Promise<string> {
  return signatureFreeDigest(await readFile(path));
}

/** See the file comment. Throws on a Mach-O whose load commands run past the file. */
export function signatureFreeDigest(file: Uint8Array): string {
  const data = Buffer.from(file); // a copy: the size fields are zeroed in place
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  if (data.length < HEADER_SIZE || data.readUInt32LE(0) !== MH_MAGIC_64) return hash(data);
  const commands = data.readUInt32LE(16);
  let end = data.length;
  let offset = HEADER_SIZE;
  for (let i = 0; i < commands; i++) {
    if (offset + 8 > data.length) throw new Error('Mach-O load commands run past the end of the file');
    const command = data.readUInt32LE(offset);
    const size = data.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > data.length) throw new Error('bad Mach-O load command size');
    if (command === LC_SEGMENT_64 && size >= 72 && segmentName(data, offset) === '__LINKEDIT') {
      data.fill(0, offset + 32, offset + 40); // vmsize
      data.fill(0, offset + 48, offset + 56); // filesize
    }
    if (command === LC_CODE_SIGNATURE && size >= 16) {
      end = data.readUInt32LE(offset + 8);
      data.fill(0, offset + 12, offset + 16); // datasize
    }
    offset += size;
  }
  if (end > data.length) throw new Error('Mach-O code signature starts past the end of the file');
  return hash(data.subarray(0, end));
}

function segmentName(data: Buffer, command: number): string {
  const raw = data.subarray(command + 8, command + 24);
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul < 0 ? raw.length : nul).toString('latin1');
}
