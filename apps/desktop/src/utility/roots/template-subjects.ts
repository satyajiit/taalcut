// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the breakdown's subject analyser (templates' `BreakdownVision.subjects`): whole heads and people over
 * the normalised reel, from the mac helper's `track.shot` detecting only (no tracking between samples). The helper
 * is started for the experiment's folder, its allowed root, and holds one hardware video session while it decodes,
 * as `render.trackSubjects` does. Without the helper the breakdown records no subjects (it warns and goes on).
 */
import {
  CancelledError,
  err,
  newId,
  ok,
  RationalTime,
  TimeRange,
  type AsyncResult,
  type Container,
  type FrameRate,
} from '@taalcut/core';
import { createSubjectTracker, type HelperRequester } from '@taalcut/render';
import type { BreakdownVision } from '@taalcut/templates';
import { dirname } from 'node:path';
import { hardwareLease } from './render-phase3';

type Helpers = (services: string, roots: readonly string[]) => AsyncResult<HelperRequester>;
type Subjects = NonNullable<BreakdownVision['subjects']>;

/** The helper caps a shot at 10 minutes; a reel is far shorter. */
const REEL_LIMIT_SECONDS = 600;

/** Detections at the helper's rate (4 a second, the breakdown's `hz` too); no tracking between them. */
export function reelSubjects(helpers: Helpers, container: Container): Subjects {
  const lease = hardwareLease(container).lease;
  return async (path, options) => {
    const helper = await helpers('track', [dirname(path)]);
    if (!helper.ok) return helper;
    const held = lease ? await lease(options.signal) : ok(null);
    if (!held.ok) return options.signal.aborted ? err(CancelledError()) : held;
    let released = false;
    const letGo = () => {
      if (released) return;
      released = true;
      void held.value?.release().catch(() => undefined);
    };
    const rate: FrameRate = options.rate;
    const length = RationalTime.of(options.frames, rate);
    const end =
      RationalTime.toSeconds(length) > REEL_LIMIT_SECONDS
        ? RationalTime.fromSeconds(REEL_LIMIT_SECONDS, rate)
        : length;
    const tracked = await createSubjectTracker(helper.value, { trackHz: 0 })
      .track({
        // Not a library asset: the id and hash only satisfy the track's shape; nothing is stored.
        assetId: newId<'Asset'>(),
        contentHash: '0'.repeat(64),
        path,
        range: TimeRange.of(RationalTime.of(0, rate), end),
        signal: options.signal,
        onLetGo: letGo,
        onSend: (pid) => held.value?.adopt?.(pid),
      })
      .finally(letGo);
    if (!tracked.ok) return tracked;
    const samples = tracked.value.track.samples
      .filter((sample) => sample.source === 'detect')
      .map((sample) => ({
        frame: RationalTime.rescale(sample.t, rate, 'round').value,
        heads: (sample.heads ?? []).map(({ box, confidence }) => ({ box, confidence })),
        people: (sample.people ?? []).map(({ box, confidence }) => ({ box, confidence })),
      }));
    return ok({ detector: 'vision' as const, samples });
  };
}
