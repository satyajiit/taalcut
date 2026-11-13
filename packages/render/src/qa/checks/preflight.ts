// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Checks that run before anything renders (docs/qa-gate.md, "Preflight"):
 * every clip's file is there and unchanged, every font matches the lock,
 * and only path d carries the reel's audio (paths a, b and c never do).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  MUSIC_COMMANDS,
  type MusicPath,
  type QaCheckResult,
  type QaFix,
} from '@taalcut/core';
import { agentFix, checkResult, commandFix, type QaFinding } from '../result';
import type { QaTarget } from './captions';

export interface MediaCheckItem {
  readonly clipId: string;
  readonly assetId: string;
  /** The file's name (never its path) for the finding. */
  readonly name: string;
  /** Null when the library has no online location. */
  readonly path: string | null;
  /** What the library recorded: size and mtime, and the content hash to fall back on. */
  readonly expected: { readonly size: number; readonly mtimeMs: number; readonly contentHash?: string };
}

export interface PreflightMediaInput {
  readonly items: readonly MediaCheckItem[];
  /** The library's content hash of a file (BLAKE3), when its fingerprint changed. */
  readonly hashFile?: (path: string) => Promise<string>;
  /** After conforming: each clip's segment must exist. */
  readonly segments?: readonly { readonly clipId: string; readonly path: string }[];
}

async function exists(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : null;
  } catch {
    return null;
  }
}

export async function preflightMediaCheck(input: PreflightMediaInput): Promise<QaCheckResult> {
  const started = performance.now();
  const findings: QaFinding[] = [];
  const fixes: QaFix[] = [];
  for (const item of input.items) {
    const found = item.path ? await exists(item.path) : null;
    let ok = false;
    if (found) {
      const sameFingerprint =
        found.size === item.expected.size && Math.abs(found.mtimeMs - item.expected.mtimeMs) < 1;
      if (sameFingerprint) ok = true;
      else if (item.expected.contentHash && input.hashFile && item.path)
        ok = (await input.hashFile(item.path)) === item.expected.contentHash;
    }
    if (ok) continue;
    findings.push({ target: { kind: 'clip', id: item.clipId }, measured: { value: found ? 1 : 0, unit: 'count' } });
    fixes.push(agentFix(found ? 'qa.fixes.mediaChanged' : 'qa.fixes.relinkMedia', { assetId: item.assetId }));
    fixes.push(agentFix('qa.fixes.swapFromAlternates', { clipId: item.clipId }));
  }
  for (const segment of input.segments ?? []) {
    if (await exists(segment.path)) continue;
    findings.push({ target: { kind: 'clip', id: segment.clipId }, measured: { value: 0, unit: 'count' } });
  }
  return checkResult(
    'preflightMedia',
    findings.length > 0 ? 'fail' : 'pass',
    { measured: { value: findings.length, unit: 'count' }, threshold: { max: 0, unit: 'count' }, findings, fixes },
    performance.now() - started,
  );
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface FontCheckItem {
  readonly file: string;
  readonly path: string;
  /** From fonts.lock.json. */
  readonly sha256: string;
}

/** Every font the composition links is the locked file, byte for byte. No fix in the app: reinstall. */
export async function preflightFontsCheck(fonts: readonly FontCheckItem[]): Promise<QaCheckResult> {
  const started = performance.now();
  const findings: QaFinding[] = [];
  for (const font of fonts) {
    const found = await exists(font.path);
    const ok = found !== null && (await sha256File(font.path)) === font.sha256;
    if (!ok) findings.push({ target: { kind: 'file', id: font.file.slice(0, 64) }, measured: { value: found ? 1 : 0, unit: 'count' } });
  }
  return checkResult(
    'preflightFonts',
    findings.length > 0 ? 'fail' : 'pass',
    { measured: { value: findings.length, unit: 'count' }, threshold: { max: 0, unit: 'count' }, findings },
    performance.now() - started,
  );
}

export interface RightsInput {
  readonly music: MusicPath;
  /** The mix plan includes the reference's own audio. */
  readonly referenceAudio: boolean;
  readonly target: QaTarget;
}

/**
 * Only path d may carry the reel's audio. Since REF1 path d needs no acknowledgement (the owner's decision of
 * 2026-10-29): its music is the reel the template keeps, and preflight has already found that file.
 */
export async function rightsReferenceAudioCheck(input: RightsInput): Promise<QaCheckResult> {
  const started = performance.now();
  const findings: QaFinding[] = [];
  const toPlatformSound = commandFix('qa.fixes.usePlatformSound', MUSIC_COMMANDS.choosePath, {
    ...input.target,
    choice: { path: 'platformSound' },
  });
  const fixes: QaFix[] = [toPlatformSound];
  if (input.music !== 'referenceAudio' && input.referenceAudio)
    findings.push({ target: { kind: 'audio', id: 'referenceSource' } });
  return checkResult(
    'rightsReferenceAudio',
    findings.length > 0 ? 'fail' : 'pass',
    { findings, fixes },
    performance.now() - started,
  );
}
