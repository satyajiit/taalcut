// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The grade's GPU route holds two hardware video sessions (the helper's AVAssetReader decode and AVAssetWriter
 * encode) from before `video.applyCube` goes out until the helper lets go of it: its answer or its exit, past a
 * cancel or a timeout (IX3-F5, H5). The CPU route's FFmpeg waits for that, so it never opens its own VideoToolbox
 * sessions beside the helper's. The helper's pid is written into the slots just before the request is sent
 * (`onSend`), so a quit or a crash of this process leaves them held until the helper exits (IX3-F7).
 */
import { ok, raceAbort, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';

/** An AVAssetReader decode and an AVAssetWriter H.264 encode. */
export const GPU_GRADE_SESSIONS = 2;

export interface HelperHold {
  /** For the applier: the helper's pid, just before the request goes to it. */
  readonly onSend: (pid: number) => void;
  /** For the applier: the helper has let go of the request. Safe to call twice. */
  readonly onLetGo: () => void;
  /** Resolves once the helper has let go and the sessions are back. */
  readonly done: Promise<void>;
}

/** Holds the GPU route's sessions on the context's gate (none to hold without one: tests and tools). */
export async function holdForHelper(
  ctx: Pick<MediaContext, 'hardwareSessions'>,
  signal?: AbortSignal,
): AsyncResult<HelperHold> {
  const lease = ctx.hardwareSessions
    ? await ctx.hardwareSessions.acquire(GPU_GRADE_SESSIONS, signal)
    : ok(null);
  if (!lease.ok) return lease;
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  let letGo = false;
  const onLetGo = () => {
    if (letGo) return;
    letGo = true;
    if (!lease.value) return resolveDone();
    lease.value.release().then(resolveDone, (cause: unknown) => {
      console.error(
        "[render] could not give back the grade's sessions; they are swept when they go stale",
        cause,
      );
      resolveDone();
    });
  };
  return ok({ onSend: (pid) => lease.value?.adopt?.(pid), onLetGo, done });
}

/** Waits for the helper to let go; a cancel while waiting returns at once (the sessions go back later). */
export const untilLetGo = (hold: HelperHold, signal?: AbortSignal): AsyncResult<void> =>
  raceAbort(
    hold.done.then(() => ok(undefined)),
    signal,
  );
