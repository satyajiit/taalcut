// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R2: listening work that may outlive its tool call. The first listen on a machine downloads the listening
 * models inside the job (about 317 MB; about 251 MB more for the first free-text search), and 20 long sounds can
 * take minutes too. The tool's call signal is aborted at its 120 s timeout, and the job follows the signal it is
 * given: the job was cancelled, and with it the download (the component manager keeps the partial file and resumes
 * it next time, but each call only bought it 120 s, twice with the retry), and the agent read a bare `core.timeout`.
 *
 * Now the work runs on a signal of its own. The caller's cancel still cancels it; but once `afterMs` passes (before
 * the executor's timeout) the tool answers `audio.listen_unavailable` (`reason: 'still_working'`, retryable) and the
 * work goes on in the jobs process: the download finishes, and the analysis lands in its cache for the next call.
 * The call's cleanup (an artifact's scratch copy) waits for the work either way.
 */
import { err, type AsyncResult } from '@taalcut/core';
import { ListenUnavailable } from '../listen/errors';

/** How long a listening tool waits for its work before answering that it goes on (its timeout is 120 s). */
export const LISTEN_DETACH_MS = 100_000;

export interface ListenWithinOptions {
  /** Default LISTEN_DETACH_MS. */
  readonly afterMs?: number;
  /** Runs once the work has settled (also when the tool answered first). */
  readonly cleanup?: () => Promise<void>;
}

/** `work` under its own signal, cancelled with the call's, left running when it outlasts `afterMs`. */
export async function listenWithin<T>(
  callSignal: AbortSignal,
  work: (signal: AbortSignal) => AsyncResult<T>,
  options: ListenWithinOptions = {},
): AsyncResult<T> {
  const own = new AbortController();
  const cancel = () => own.abort(callSignal.reason);
  if (callSignal.aborted) cancel();
  else callSignal.addEventListener('abort', cancel, { once: true });
  const running = work(own.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), options.afterMs ?? LISTEN_DETACH_MS);
  });
  try {
    const first = await Promise.race([running, late]);
    if (first !== 'late') {
      await options.cleanup?.();
      return first;
    }
  } catch (cause) {
    await options.cleanup?.();
    throw cause;
  } finally {
    clearTimeout(timer);
    callSignal.removeEventListener('abort', cancel);
  }
  // Still working: it finishes in the jobs process; its result is dropped, its models and analysis kept.
  void running
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => options.cleanup?.())
    .catch(() => undefined);
  return err(
    ListenUnavailable(
      { reason: 'still_working' },
      {
        detail:
          'still listening: the first listen downloads its models (about 320 MB), or the sounds are long. ' +
          'The work goes on in the background; ask again in a minute.',
      },
    ),
  );
}
