// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CancelledError,
  err,
  ok,
  RationalTime,
  SubjectSourceToken,
  type AsyncResult,
  type Box,
  type ClipVisualLayout,
  type Container,
  type ShortEditPlan,
  type SubjectSpan,
} from '@taalcut/core';
import { createShortLayout, headsOf } from '@taalcut/timeline';
import { LibraryDatabaseToken } from '../../shared/tokens';

const bounded = (box: Box): Box => {
  const x = Math.max(0, Math.min(1, box.x));
  const y = Math.max(0, Math.min(1, box.y));
  return {
    x,
    y,
    width: Math.max(0, Math.min(1, box.x + box.width) - x),
    height: Math.max(0, Math.min(1, box.y + box.height) - y),
  };
};
const union = (boxes: readonly Box[]): Box => {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return bounded({
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  });
};
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Consistent left-to-right envelopes, without claiming identity or active-speaker tracking. */
export function shortSubjects(span: SubjectSpan): { people: Box[]; content?: Box } {
  const samples = span.samples.filter((sample) => sample.source === 'detect');
  const detections = samples.map((sample) => {
    const bodies = (sample.people ?? sample.humans)
      .filter((person) => person.confidence >= 0.5)
      .map((person) => person.box);
    return (
      bodies.length
        ? bodies
        : headsOf(
            {
              ...sample,
              faces: sample.faces.filter((face) => face.confidence >= 0.5),
              ...(sample.heads ? { heads: sample.heads.filter((head) => head.confidence >= 0.5) } : {}),
            },
            span.frame ? span.frame.height / span.frame.width : 9 / 16,
          )
    )
      .map(bounded)
      .filter((box) => box.width > 0 && box.height > 0)
      .sort((a, b) => a.x - b.x);
  });
  const count = detections[0]?.length ?? 0;
  // Shot changes or uncertain detections retain the whole original frame rather than cutting out a participant.
  if (count < 1 || count > 2 || detections.some((boxes) => boxes.length !== count)) return { people: [] };
  const people = Array.from({ length: count }, (_, index) => union(detections.map((boxes) => boxes[index]!)));
  if (people.length === 2 && intersects(people[0]!, people[1]!)) return { people: [] };
  const salient = samples
    .flatMap((sample) => sample.saliency)
    .filter((item) => item.confidence >= 0.65 && item.box.width * item.box.height >= 0.08)
    .map((item) => bounded(item.box))
    .filter((box) => !people.some((person) => intersects(box, person)));
  return { people, ...(count === 1 && salient.length ? { content: union(salient) } : {}) };
}

/** Track the selected excerpts only, then choose editable static framing from the persisted source boxes. */
export async function shortLayouts(
  container: Container,
  plan: ShortEditPlan,
  signal?: AbortSignal,
): AsyncResult<ReadonlyMap<number, ClipVisualLayout>> {
  if (signal?.aborted) return err(CancelledError());
  const layouts = new Map<number, ClipVisualLayout>();
  const subjects = container.has(SubjectSourceToken) ? container.resolve(SubjectSourceToken) : null;
  const ranges = plan.visuals.map(({ source }) => ({
    assetId: source.assetId,
    start: source.range.start,
    end: RationalTime.add(source.range.start, source.range.duration),
  }));
  if (subjects) {
    const ensured = await subjects.ensure(ranges, signal);
    if (!ensured.ok && ensured.error.code === 'core.cancelled') return ensured;
  }
  for (const [index, clip] of ranges.entries()) {
    if (signal?.aborted) return err(CancelledError());
    const read = subjects ? await subjects.over(clip, signal) : null;
    const span = read?.ok ? read.value : undefined;
    let source = span?.frame;
    if (!source && container.has(LibraryDatabaseToken)) {
      const row = container
        .resolve(LibraryDatabaseToken)
        .driver.prepare('SELECT width, height, rotation_degrees FROM assets WHERE id = ?')
        .get(clip.assetId);
      if (row && Number(row.width) > 0 && Number(row.height) > 0) {
        const turned = row.rotation_degrees === 90 || row.rotation_degrees === 270;
        source = {
          width: Number(turned ? row.height : row.width),
          height: Number(turned ? row.width : row.height),
        };
      }
    }
    // Whole-frame contain is independent of aspect when dimensions or detector evidence are unavailable.
    layouts.set(
      index,
      createShortLayout({
        at: clip.start,
        source: source ?? { width: 16, height: 9 },
        ...(span ? shortSubjects(span) : {}),
      }),
    );
  }
  return ok(layouts);
}
