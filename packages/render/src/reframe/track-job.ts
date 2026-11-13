// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `render.trackSubjects` job (SPEC P3.2, "Inputs"): the jobs process runs the helper's `track.shot` for one
 * shot and keeps the track as derived JSON. A track already cached is the answer at once. The helper decodes
 * with VideoToolbox, so the call holds one hardware video session for its whole length.
 */
import { createHash } from 'node:crypto';
import {
  CancelledError,
  defineJobKind,
  err,
  NotFoundError,
  ok,
  registerJob,
  SUBJECT_TRACK_JOB_KIND,
  trackSubjectsJobInputSchema,
  trackSubjectsJobOutputSchema,
  type AssetId,
  type AsyncResult,
  type DerivedFileRef,
  type JobRegistration,
  type RetryPolicy,
  type SubjectTrack,
} from '@taalcut/core';
import { SUBJECT_TRACK_FILE_VERSION, type SubjectTrackStore } from './subject-store';
import type { SubjectTracker } from './subject-tracker';

/** Two attempts: `track.decode_failed` is retryable, a refused path or a bad file isn't. */
export const TRACK_SUBJECTS_RETRY: RetryPolicy = {
  maxAttempts: 2,
  backoff: { kind: 'fixed', delayMs: 2_000 },
};
export const TRACK_SUBJECTS_TIMEOUT_MS = 20 * 60_000;

export const trackSubjectsJob = defineJobKind({
  kind: SUBJECT_TRACK_JOB_KIND,
  input: trackSubjectsJobInputSchema,
  output: trackSubjectsJobOutputSchema,
  resource: 'gpu',
  // An export waits on it (the `reframing` stage).
  priority: 'high',
  retry: TRACK_SUBJECTS_RETRY,
  timeoutMs: TRACK_SUBJECTS_TIMEOUT_MS,
  resumable: true,
  idempotencyKey: (input) =>
    createHash('sha256')
      .update(
        JSON.stringify([
          'render.trackSubjects',
          input.assetId,
          [input.range.start.value, input.range.start.rate.num, input.range.start.rate.den],
          [input.range.duration.value, input.range.duration.rate.num, input.range.duration.rate.den],
        ]),
      )
      .digest('hex'),
});

export interface TrackSubjectsDeps {
  readonly tracker: SubjectTracker;
  readonly store: SubjectTrackStore;
  /** The asset's original on disk and its content hash, or null when it is offline. */
  asset(assetId: AssetId): AsyncResult<{ readonly path: string; readonly contentHash: string } | null>;
  /**
   * Holds one hardware video session while the helper decodes, released when the tracker lets go of the request
   * (`TrackShotInput.onLetGo`); absent in tests and tools.
   */
  lease?(signal: AbortSignal): AsyncResult<{ release(): Promise<void>; adopt?(pid: number): void }>;
  /** The requests that ran on the CPU, for compute.fallback (ADR 0002). */
  onCpu?(parts: readonly string[]): void;
}

export function trackSubjectsRegistration(deps: TrackSubjectsDeps): JobRegistration {
  return registerJob(trackSubjectsJob, async (input, context) => {
    const cached = await deps.store.get(input.assetId, input.range);
    if (!cached.ok) return cached;
    if (cached.value) return ok({ track: refOf(deps.store, cached.value) });
    const asset = await deps.asset(input.assetId);
    if (!asset.ok) return asset;
    if (!asset.value) return err(NotFoundError({ entity: 'asset', id: input.assetId }));
    const lease = deps.lease ? await deps.lease(context.signal) : ok(null);
    if (!lease.ok) return context.signal.aborted ? err(CancelledError()) : lease;
    // The session is the helper's until it lets go of the request, not until `track` returns: a cancel or a
    // timeout returns first while the helper may still be decoding (IX3-F5, H6).
    let released = false;
    const onLetGo = () => {
      if (released) return;
      released = true;
      void lease.value?.release().catch((cause: unknown) => {
        console.error('[render] could not give back a tracking lease; it is swept when it goes stale', cause);
      });
    };
    const tracked = await deps.tracker
      .track({
        assetId: input.assetId,
        contentHash: asset.value.contentHash,
        path: asset.value.path,
        range: input.range,
        signal: context.signal,
        // The helper's pid is on the slot before the request goes out: a quit or a crash keeps it held (IX3-F7).
        onSend: (pid) => lease.value?.adopt?.(pid),
        onLetGo,
      })
      .catch((cause: unknown) => {
        // A tracker that throws has no request left to wait for (a helper's own let-go still comes once).
        onLetGo();
        throw cause;
      });
    if (!tracked.ok) return tracked;
    if (tracked.value.cpu.length > 0) deps.onCpu?.(tracked.value.cpu);
    const stored = await deps.store.put(tracked.value.track);
    return stored.ok ? ok({ track: stored.value }) : stored;
  });
}

/** A cached track's file reference (the key is a function of the track itself). */
function refOf(store: SubjectTrackStore, track: SubjectTrack): DerivedFileRef {
  const key = store.keyFor(track.contentHash, track.range);
  return {
    kind: 'subjectTrack',
    key,
    bytes: Buffer.byteLength(JSON.stringify(track)),
    mimeType: 'application/json',
    recipe: SUBJECT_TRACK_FILE_VERSION,
  };
}
