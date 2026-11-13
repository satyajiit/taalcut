// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per file (IX-B2): each stage's busy time (its job's run, finish minus start) and, for a generated set, the looks
 * its shots were drawn with (manifest.json), so files that cost more can be told apart: on ix-v1 the `pattern`
 * look (lavfi testsrc2) burns in a running clock that OCR reads as changing text. And the decode counters the
 * decode lane's stage jobs report in their output (`decodes`, specs/requests-decode-to-bench.md): per stage
 * summed over files, and per video file the original's full decodes and the FFmpeg and ffprobe spawns.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILE, readManifest } from '@taalcut/bench-footage';
import { median } from '../baseline';
import type { DecodeCounts, StageRow } from './library-rows';
import { ran, type StageSpan } from './spans';

export interface FileBusy {
  readonly file: string;
  readonly assetKind: string;
  /** Busy ms per stage that ran. */
  readonly busyMs: Readonly<Record<string, number>>;
  readonly totalMs: number;
  /** The looks of the file's shots in order (generated sets only). */
  readonly looks: readonly string[] | null;
}

/** The shots' looks per file, from a generated set's manifest; empty for a set without one (smoke). */
export function footageLooks(dir: string): ReadonlyMap<string, readonly string[]> {
  if (!existsSync(join(dir, MANIFEST_FILE))) return new Map();
  return new Map(readManifest(dir).clips.map((clip) => [clip.file, clip.shots.map((shot) => shot.look)]));
}

export function busyByFile(
  spans: readonly StageSpan[],
  looks: ReadonlyMap<string, readonly string[]>,
): FileBusy[] {
  const files = new Map<string, { assetKind: string; busyMs: Record<string, number> }>();
  for (const span of spans) {
    const entry = files.get(span.file) ?? { assetKind: span.assetKind, busyMs: {} };
    files.set(span.file, entry);
    if (ran(span))
      entry.busyMs[span.stage] = (entry.busyMs[span.stage] ?? 0) + span.finishedMs - span.startedMs;
  }
  return [...files.entries()]
    .map(([file, entry]) => ({
      file,
      assetKind: entry.assetKind,
      busyMs: entry.busyMs,
      totalMs: Object.values(entry.busyMs).reduce((sum, ms) => sum + ms, 0),
      looks: looks.get(file) ?? null,
    }))
    .sort((left, right) => right.totalMs - left.totalMs);
}

const COUNTERS = ['ffmpeg', 'ffprobe', 'fullDecodes', 'partialDecodes', 'originalFullDecodes'] as const;

export interface DecodeReport {
  /** Stage rows whose output carried `decodes`. */
  readonly rows: number;
  /** Rows whose `decodes` did not have the agreed shape (left out). */
  readonly unreadable: number;
  /** Over video files with counters: full decodes of the original (target 2), and FFmpeg plus ffprobe spawns. */
  readonly medianOriginalFullDecodes: number | null;
  readonly medianSpawns: number | null;
  readonly byStage: readonly ({ readonly stage: string } & DecodeCounts)[];
}

const zero = (): Record<(typeof COUNTERS)[number], number> => ({
  ffmpeg: 0,
  ffprobe: 0,
  fullDecodes: 0,
  partialDecodes: 0,
  originalFullDecodes: 0,
});

/** Null when no stage row reported decodes (before the decode lane's counters). */
export function decodeReport(rows: readonly StageRow[]): DecodeReport | null {
  const counted = rows.filter((row) => row.decodes !== null);
  const unreadable = rows.filter((row) => row.decodesUnreadable).length;
  if (counted.length === 0 && unreadable === 0) return null;
  const byStage = new Map<string, Record<(typeof COUNTERS)[number], number>>();
  const byVideo = new Map<string, Record<(typeof COUNTERS)[number], number>>();
  for (const row of counted) {
    const stage = byStage.get(row.stage) ?? zero();
    byStage.set(row.stage, stage);
    const video = row.assetKind === 'video' ? (byVideo.get(row.assetId) ?? zero()) : null;
    if (video !== null) byVideo.set(row.assetId, video);
    for (const counter of COUNTERS) {
      stage[counter] += row.decodes?.[counter] ?? 0;
      if (video !== null) video[counter] += row.decodes?.[counter] ?? 0;
    }
  }
  const videos = [...byVideo.values()];
  return {
    rows: counted.length,
    unreadable,
    medianOriginalFullDecodes: videos.length === 0 ? null : median(videos.map((v) => v.originalFullDecodes)),
    medianSpawns: videos.length === 0 ? null : median(videos.map((v) => v.ffmpeg + v.ffprobe)),
    byStage: [...byStage.entries()]
      .map(([stage, counts]) => ({ stage, ...counts }))
      .sort((a, b) => a.stage.localeCompare(b.stage)),
  };
}
