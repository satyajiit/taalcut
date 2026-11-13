// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A gated composition as the timeline keeps it (HFW1 "dsn"), and where a new graphic comes on. The record is core's
 * `graphicComposition`: its files by content, its hash over them, its variables and length from the gate, the
 * gate's report, and who made it. A new graphic's time is the person's: a second of the video, words someone says,
 * or what they pointed at (an editor target); with none, a second in.
 */
import {
  err,
  findEditItem,
  FrameRates,
  graphicCompositionSchema,
  ok,
  RationalTime,
  resolveEditTarget,
  ValidationError,
  type GraphicAnchor,
  type GraphicComposition,
  type GraphicCompositionId,
  type Result,
  type Timeline,
} from '@taalcut/core';
import { z } from 'zod';
import type { WorkspaceToolDeps } from './deps';
import { refusalText, type GatedEntry } from './gate-run';

export interface CompositionMeta {
  readonly id: GraphicCompositionId;
  readonly version: number;
  /** The designing model's name for it ("Chat bubble"). */
  readonly name: string;
  readonly request?: string;
  readonly overlays?: readonly string[];
}

/** The record of a composition that passed, or the gate's refusal with what to fix. */
export async function compositionOf(
  deps: WorkspaceToolDeps,
  gated: GatedEntry,
  meta: CompositionMeta,
): Promise<Result<GraphicComposition>> {
  const { result } = gated;
  if (!result.gate.passed || result.durationSeconds === undefined)
    return err(ValidationError({ field: 'entry' }, { detail: refusalText(result) }));
  const model = deps.designer ? await deps.designer() : null;
  const parsed = graphicCompositionSchema.safeParse({
    id: meta.id,
    version: meta.version,
    hash: gated.hash,
    name: meta.name,
    entry: gated.entry.path,
    files: gated.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
    variables: result.variables,
    durationSeconds: result.durationSeconds,
    provenance: {
      model: model ? { id: model.id.slice(0, 120), onDevice: model.onDevice } : null,
      overlays: meta.overlays ?? [],
      brief: null,
      ...(meta.request ? { request: meta.request.slice(0, 500) } : {}),
      createdAt: deps.now?.() ?? Date.now(),
    },
    gate: result.gate,
  });
  return parsed.success
    ? ok(parsed.data)
    : err(ValidationError({ field: 'composition' }, { detail: z.prettifyError(parsed.error) }));
}

export interface When {
  readonly at?: number | undefined;
  readonly phrase?: string | undefined;
  readonly target?: unknown;
}

/** Where a new graphic comes on, as its anchor; core.validation for a target the timeline doesn't hold. */
export function anchorFor(timeline: Timeline, when: When): Result<GraphicAnchor> {
  const rate = timeline.canvas.rate;
  const frameAt = (seconds: number) => RationalTime.of(Math.round((seconds * rate.num) / rate.den), rate);
  if (when.phrase) return ok({ kind: 'phrase', text: when.phrase.slice(0, 80), occurrence: 1 });
  if (when.at !== undefined) return ok({ kind: 'time', at: frameAt(when.at) });
  if (when.target !== undefined) {
    const target = resolveEditTarget(when.target, timeline);
    if (!target) return err(ValidationError({ field: 'target' }, { detail: 'The target is not on this timeline' }));
    if (target.kind === 'item') {
      const place = findEditItem(timeline, target.itemId);
      if (place) return ok({ kind: 'time', at: RationalTime.of(place.start, rate) });
    }
    if (target.kind === 'range') return ok({ kind: 'time', at: target.range.start });
  }
  return ok({ kind: 'time', at: frameAt(1) });
}

/** A length in seconds as a graphic's duration (exact milliseconds). */
export const durationOf = (seconds: number) => RationalTime.of(Math.round(seconds * 1000), FrameRates.milliseconds);
