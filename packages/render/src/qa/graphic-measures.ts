// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The graphics checks' measurements, kept by what a graphic draws (HFW1): its composition's hash, its params, the
 * canvas, the frame rate and its length (a composition covers the canvas and its exit moves with the item's end, so
 * where it sits on the timeline changes nothing it draws). A graphic none of that changed for is not drawn again for
 * its own checks: a later QA round, or a later export after a caption edit, reads it here. In memory, per render
 * process, the most recent `limit` graphics.
 */
import { createHash } from 'node:crypto';
import type { Rect } from '@taalcut/core';
import type { QaGraphic, QaPlan } from '../types';

/** What a graphic draws at one of its moments, by frames from its start. */
export interface CachedMeasure {
  readonly fullCanvas?: boolean;
  readonly offset: number;
  readonly box: Rect | null;
  readonly minFontPx?: number;
  readonly capShare: number;
}

export interface GraphicMeasureCache {
  get(key: string): readonly CachedMeasure[] | undefined;
  set(key: string, measures: readonly CachedMeasure[]): void;
}

/** The DOM probe's composition boxes and the moments they are read at; a change to either is a new key. */
const MEASURE_VERSION = 2;

const sorted = (params: QaGraphic['params']) =>
  Object.keys(params)
    .sort()
    .map((name) => [name, params[name]] as const);

export function measureKey(
  graphic: QaGraphic,
  plan: Pick<QaPlan, 'width' | 'height' | 'rateNum' | 'rateDen'>,
): string {
  const drawn = [
    MEASURE_VERSION,
    graphic.hash,
    sorted(graphic.params),
    plan.width,
    plan.height,
    plan.rateNum,
    plan.rateDen,
    graphic.span.end - graphic.span.start,
  ];
  return createHash('sha256').update(JSON.stringify(drawn)).digest('hex');
}

/** A least-recently-used map of measurements. */
export function createGraphicMeasureCache(limit = 256): GraphicMeasureCache {
  const entries = new Map<string, readonly CachedMeasure[]>();
  return {
    get(key) {
      const found = entries.get(key);
      if (found === undefined) return undefined;
      entries.delete(key);
      entries.set(key, found);
      return found;
    },
    set(key, measures) {
      entries.delete(key);
      entries.set(key, measures);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}
