// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C2: the reel's effects as an `sfx.setHits` payload for a video made from its template. Each effect on a cut
 * (reel-hits.ts) becomes a take of a bank sound of its family (the SFX bank, EAR1-D2), placed as audio's bank planner
 * places one (audio's `placeHit`): the take's apex, or its onset where the reel's event was heard as an attack
 * (EAR1-R2, `align`), at the cut plus the reel's offset, levelled under the bed (a plain hit 4 dB further down),
 * trimmed at the timeline's ends, overlaps resolved as audio resolves them (`withoutOverlaps`: each sound keeps its
 * apex). Each hit names its cut (EAR1-K3). The takes used go to the library as bundled `sfx-bank` items under their
 * own licence (audio's importBankTakes). A sound's takes are used in turn, so a repeated whoosh isn't the same file
 * every time.
 */
import {
  MIX_COMMANDS,
  mixCommandPayloads,
  ok,
  type AsyncResult,
  type GeneratedAssetSink,
  type SfxHit,
  type Template,
  type Timeline,
} from '@taalcut/core';
import {
  bankHitRecords,
  bankPick,
  importBankTakes,
  placeHit,
  plainTakes,
  withoutOverlaps,
  type BankPick,
  type PlannedHit,
  type SfxBank,
} from '@taalcut/audio';
import type { z } from 'zod';
import { reelHitRequests, reelSoundFor, type ReelHitRequest } from './reel-hits';

export type SetHitsPayload = z.output<(typeof mixCommandPayloads)[typeof MIX_COMMANDS.setHits]>;

export interface ReelSfxDeps {
  /** The installed `sfx-bank` component (audio's loadSfxBank). */
  readonly bank: SfxBank;
  readonly sink: GeneratedAssetSink;
}

/** The video's length in ms: its last cut, then the last shot (the cut list stops at the last cut). */
function timelineMs(timeline: Timeline): number {
  const track = timeline.tracks.find((candidate) => candidate.kind === 'video');
  const frameMs = (1000 * timeline.canvas.rate.den) / timeline.canvas.rate.num;
  let frames = 0;
  for (const item of track?.items ?? []) if (item.type !== 'transition') frames += item.duration.value;
  return frames * frameMs;
}

/** Each request placed with its pick: the pick's anchor on the cut plus the reel's offset, without overlaps. */
function placed(
  requests: readonly ReelHitRequest[],
  pickFor: (request: ReelHitRequest) => BankPick | null,
  lengthMs: number,
): { hits: PlannedHit[]; picks: Map<string, BankPick> } {
  const picks = new Map<string, BankPick>();
  const hits: PlannedHit[] = [];
  for (const request of requests) {
    const pick = pickFor(request);
    if (!pick) continue;
    const target = {
      cutIndex: request.cutIndex,
      cutMs: request.cutMs,
      atMs: request.cutMs + request.offsetMs,
    };
    const hit = placeHit(target, request.family, pick.sound, lengthMs);
    if (!hit) continue;
    picks.set(pick.sound.id, pick);
    hits.push(hit);
  }
  return { hits: withoutOverlaps(hits), picks };
}

/**
 * The reel's effects as bank hits on the timeline's cuts; null when they can't be placed (no listening, or the
 * timeline's cuts aren't the template's). The `sfx.setHits` records name each bank sound.
 */
export async function reelSfxHits(
  template: Template,
  timeline: Timeline,
  deps: ReelSfxDeps,
  signal?: AbortSignal,
): AsyncResult<SfxHit[] | null> {
  const requests = reelHitRequests(template, timeline);
  if (!requests) return ok(null);
  const uses = new Map<string, number>();
  const pickFor = (request: ReelHitRequest): BankPick | null => {
    const item = reelSoundFor(deps.bank.items, request.family, request.soundHint);
    const takes = item ? plainTakes(item) : [];
    if (!item || takes.length === 0) return null;
    const turn = uses.get(item.id) ?? 0;
    uses.set(item.id, turn + 1);
    const take = takes[turn % takes.length]!;
    // EAR1-R2: an effect heard as an attack is placed by the take's onset; a swell by its apex (the default).
    const anchor = request.align === 'onset' ? { anchorMs: take.onsetMs } : {};
    return bankPick(deps.bank, item, take, request.family, anchor);
  };
  const plan = placed(requests, pickFor, timelineMs(timeline));
  const assets = await importBankTakes(deps.sink, plan.hits, plan.picks, signal);
  if (!assets.ok) return assets;
  return ok(bankHitRecords(plan.hits, plan.picks, assets.value));
}

/** The `sfx.setHits` payload that puts the reel's effects on the timeline; null as reelSfxHits. */
export async function reelSfxPayload(
  template: Template,
  timeline: Timeline,
  deps: ReelSfxDeps,
  signal?: AbortSignal,
): AsyncResult<SetHitsPayload | null> {
  const hits = await reelSfxHits(template, timeline, deps, signal);
  if (!hits.ok || hits.value === null) return hits.ok ? ok(null) : hits;
  return ok(
    mixCommandPayloads[MIX_COMMANDS.setHits].parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      revision: timeline.revision,
      hits: hits.value,
    }),
  );
}
