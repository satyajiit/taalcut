// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A read end of the helper pass's FIFO that this process holds and never reads (IX3-F4). The decode service opens
 * the FIFO's write end without blocking and gives up when no reader has opened it within its wait (10 s,
 * native/mac-helper `RawSink.readerWaitSeconds`): the pass fails with `decode.output_closed` before any frame and
 * goes to FFmpeg's route. Its reader is a CPU FFmpeg this process starts, and on a loaded Mac the start alone can
 * take longer than that (the parallel `pnpm test` at load 14 did). With this end open from before the service is
 * asked, the service's open succeeds at once; it writes until the pipe's buffer is full, then waits on the reader,
 * which paces the pass as before (the bytes stay in the pipe until a reader takes them, and only the FFmpeg reads).
 *
 * The hold ends when the reader exits, so a reader that died leaves the service a pipe with no reader: its write
 * fails (EPIPE, `decode.output_closed`), as without the hold, and never blocks with its session open.
 */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { SidecarFailed } from '../sidecar/errors';

export interface FifoHold {
  /** Closes the read end; later calls do nothing. */
  release(): Promise<void>;
}

/** Opens `fifo` for reading without blocking: that succeeds before any writer has opened it. */
export async function holdFifo(fifo: string): AsyncResult<FifoHold> {
  const handle = await open(fifo, constants.O_RDONLY | constants.O_NONBLOCK).then(
    (opened) => ok(opened),
    (cause: unknown) => err(SidecarFailed(undefined, { detail: `holding the FIFO open: ${String(cause)}` })),
  );
  if (!handle.ok) return handle;
  let released: Promise<void> | undefined;
  return ok({
    release: () => (released ??= handle.value.close()),
  });
}
