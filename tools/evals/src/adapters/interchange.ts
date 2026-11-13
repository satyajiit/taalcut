// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writes an in-memory timeline through the otio and fcpxml exporters and scores each file's own
 * cut list with `cutDifferences`. External checkers are injected; the CLI one may spawn a tool.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_MIX,
  FrameRate,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  timelineSchema,
  type Timeline,
} from '@taalcut/core';
import { cutDifferences, cutList, defaultExporterRegistry, type CutList } from '@taalcut/timeline';
import type { InterchangeFormatScore, InterchangeLabel, InterchangePrediction } from '../interchange/schema';
import { requireSyntheticLabels } from './synthetic-only';

export type ExternalStatus = 'ok' | 'failed' | 'not available';

/** `failed` fails the case; `not available` (no tool, no DTD) is reported and does not. */
export interface ExternalCheck {
  readonly format: 'otio' | 'fcpxml';
  readonly status: ExternalStatus;
  readonly detail: string;
}

export interface ExternalChecker {
  check(format: 'otio' | 'fcpxml', text: string): ExternalCheck;
}

const FORMATS = ['otio', 'fcpxml'] as const;

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function toolOnPath(command: string): boolean {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return !isEnoent(result.error);
}

function ran(format: 'otio' | 'fcpxml', tool: string, status: number | null): ExternalCheck {
  return status === 0
    ? { format, status: 'ok', detail: `${tool} ok` }
    : { format, status: 'failed', detail: `${tool} exit ${status ?? 'error'}` };
}

function otiocat(text: string): ExternalCheck {
  if (!toolOnPath('otiocat'))
    return { format: 'otio', status: 'not available', detail: 'otiocat not available' };
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-otio-'));
  try {
    const file = join(dir, 'timeline.otio');
    writeFileSync(file, text);
    return ran('otio', 'otiocat', spawnSync('otiocat', [file], { encoding: 'utf8' }).status);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function xmllint(text: string): ExternalCheck {
  if (!toolOnPath('xmllint'))
    return { format: 'fcpxml', status: 'not available', detail: 'xmllint not available' };
  const dtd = process.env.TAALCUT_FCPXML_DTD;
  if (dtd === undefined || dtd.length === 0) {
    return { format: 'fcpxml', status: 'not available', detail: 'xmllint present; DTD not available' };
  }
  const result = spawnSync('xmllint', ['--noout', '--dtdvalid', dtd, '-'], { encoding: 'utf8', input: text });
  return ran('fcpxml', 'xmllint', result.status);
}

/** `otiocat` and `xmllint` when present. Absence is `not available`; a non-zero exit is `failed`. */
export const pathChecker: ExternalChecker = {
  check(format, text) {
    return format === 'otio' ? otiocat(text) : xmllint(text);
  },
};

/** Frame delta, or at least 1 when the cut's identity or in-point differs. 0 when `cutDifferences` is empty. */
export function cutDelta(expected: CutList, actual: CutList): number {
  if (cutDifferences(expected, actual, 0).length === 0) return 0;
  const order = (a: CutList[number], b: CutList[number]) =>
    a.track < b.track ? -1 : a.track > b.track ? 1 : a.start - b.start || a.frames - b.frames;
  const want = [...expected].sort(order);
  const got = [...actual].sort(order);
  let max = 1;
  const count = Math.max(want.length, got.length);
  for (let index = 0; index < count; index += 1) {
    const left = want[index];
    const right = got[index];
    if (left === undefined || right === undefined) continue;
    max = Math.max(
      max,
      Math.abs(left.start - right.start),
      Math.abs(left.start + left.frames - (right.start + right.frames)),
    );
  }
  return max;
}

/**
 * `count` clips at 29.97 fps with uneven lengths and non-zero in-points, so a rounding slip in either writer's
 * rational time moves a cut or an in-point and shows up as a delta.
 */
export function clipTimeline(count: number): Timeline {
  const rate = FrameRate.of(30000, 1001);
  const items = Array.from({ length: count }, (_, index) => {
    const frames = 17 + ((index * 7) % 41);
    const inPoint = (index * 13) % 60;
    return {
      type: 'clip' as const,
      id: newId<'TimelineItem'>(),
      media: {
        kind: 'video' as const,
        assetId: newId<'Asset'>(),
        shotId: null,
        available: {
          start: RationalTime.of(0, rate),
          duration: RationalTime.of(inPoint + frames + 30, rate),
        },
      },
      sourceStart: RationalTime.of(inPoint, rate),
      duration: RationalTime.of(frames, rate),
      speed: null,
      slotId: null,
      syncPoint: null,
      beatAnchor: null,
      fit: 'cover' as const,
      audio: { gainDb: 0, muted: false },
      locked: false,
      enabled: true,
      stillMotion: null,
      reframe: null,
    };
  });
  return timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Interchange',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate },
    template: null,
    beatMap: null,
    tracks: [{ kind: 'video', id: 'V1', name: 'Video', enabled: true, items }],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 1,
    updatedAt: 1,
  });
}

function scoreFormat(
  timeline: Timeline,
  format: 'otio' | 'fcpxml',
  checker: ExternalChecker,
): InterchangeFormatScore {
  const registry = defaultExporterRegistry();
  const exporter = registry.get(format);
  if (!exporter.ok) throw new Error(`interchange ${format}: ${exporter.error.code}`);
  const written = exporter.value.write(timeline, { media: new Map(), pathStyle: 'fileUrl' });
  if (!written.ok) throw new Error(`interchange ${format}: ${written.error.code}`);
  const expected = cutList(timeline);
  const external = checker.check(format, written.value.text);
  return {
    format,
    maxCutDeltaFrames: cutDelta(expected, written.value.cutList),
    externalStatus: external.status,
    externalDetail: external.detail,
  };
}

export function predictInterchange(
  labels: readonly InterchangeLabel[],
  checker: ExternalChecker,
): InterchangePrediction[] {
  requireSyntheticLabels('interchange', labels, "the render goldens' timelines loaded through the library");
  return labels.map((label) => ({
    caseId: label.caseId,
    formats: FORMATS.map((format) => scoreFormat(clipTimeline(label.clipCount), format, checker)),
  }));
}
