// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The producer's share of the app-wide hardware session cap (media's
 * HardwareSessionGate). Conform, QA and finishing run FFmpeg through
 * `ctx.runner`, which already waits for a slot. The producer spawns its own
 * FFmpeg and Chrome, so the export holds their sessions here for the whole
 * capture: the `h264_videotoolbox` encode, and Chrome's hardware decode of
 * the conformed segments. The engine's GPU encoder probe (a trial
 * `h264_videotoolbox` encode) is never killed past its 2 s deadline, so the
 * sessions stay held until it has exited too (IX3-F5, H3), and the slots
 * name every process the engine runs, so they outlive a quit or a crash of
 * this process while one runs (IX3-F7). A Chrome whose close missed the
 * engine's 5 s timeout has had its one SIGTERM and may still be in
 * VideoToolbox, so the sessions stay held until every process the engine
 * started during the export has exited (IX3-F8).
 */
import { CancelledError, err, type AsyncResult } from '@taalcut/core';
import { releaseWhenExited, type MediaContext } from '@taalcut/media';
import { loadProducerEngine } from './producer';

export interface ProducerRoute {
  readonly gpuEncode: boolean;
  readonly browserGpu: 'hardware' | 'software';
}

/** Sessions the producer opens: one for the VideoToolbox encode, one for Chrome's hardware video decode. */
export function producerSessionWeight(route: ProducerRoute): number {
  return (route.gpuEncode ? 1 : 0) + (route.browserGpu === 'hardware' ? 1 : 0);
}

/** What the producer's engine says about the processes it runs (the patched engine, IX3-F5 H3, IX3-F7). */
export interface ProducerChildren {
  /** Tells `listener` of every process the engine runs, by pid as it starts and exits; returns the unsubscribe. */
  watch(listener: (pid: number, event: 'spawn' | 'exit') => void): () => void;
  /** Null when no GPU probe runs, else its exit (wrapped, so asking never waits for the exit). */
  probesLeft(): { readonly exited: Promise<void> } | null;
}

const engineChildren = async (): Promise<ProducerChildren | null> => {
  const loaded = await loadProducerEngine().then(
    (engine) => ({ engine }),
    (cause: unknown) => {
      // The producer loads this engine itself, so nothing of the engine's runs where it doesn't load.
      console.error("[render] could not load the producer's engine to follow its processes", cause);
      return null;
    },
  );
  if (!loaded) return null;
  const { engine } = loaded;
  return {
    watch: (listener) => engine.onChildProcess(listener),
    probesLeft: () => {
      const exited = engine.gpuProbesExited();
      return exited ? { exited } : null;
    },
  };
};

/**
 * Runs `work` while holding the producer's sessions; without a gate (tests, tools) it just runs. Every process the
 * engine starts meanwhile is written into the slots at its spawn (Chrome too, IX3-F8) and taken off at its exit, so
 * a quit or a crash of this process leaves the slots held while one may be in VideoToolbox (IX3-F7). The sessions go
 * back once `work` returned, the GPU probes have exited and so has every process followed here (a Chrome past its
 * close timeout, IX3-F8), with no time cap; the result does not wait for that. A process the engine starts after
 * `work` returned isn't this export's and isn't recorded.
 */
export async function withProducerSessions<T>(
  ctx: Pick<MediaContext, 'hardwareSessions'>,
  route: ProducerRoute,
  signal: AbortSignal | undefined,
  work: () => AsyncResult<T>,
  children: () => Promise<ProducerChildren | null> = engineChildren,
): AsyncResult<T> {
  const weight = producerSessionWeight(route);
  if (!ctx.hardwareSessions || weight === 0) return work();
  const lease = await ctx.hardwareSessions.acquire(weight, signal);
  if (!lease.ok) return signal?.aborted ? err(CancelledError()) : lease;
  const engine = await children();
  const followed = followChildren(lease.value);
  const stop = engine?.watch(followed.tell);
  followed.beginWork();
  try {
    return await work();
  } finally {
    const left = [engine?.probesLeft()?.exited, followed.workDone()].filter((exit) => exit !== undefined);
    if (left.length === 0) {
      stop?.();
      await lease.value.release();
    } else {
      // Watched until then, so each pid stays in the slots until its own exit.
      releaseWhenExited(
        lease.value,
        Promise.all(left).then(() => stop?.()),
      );
    }
  }
}

/** Records the engine's processes in the lease's slots, and says when the ones started during `work` have all exited. */
function followChildren(lease: { adopt?(pid: number): void; forget?(pid: number): void }) {
  const running = new Set<number>();
  let started = false;
  let done = false;
  let allExited: (() => void) | undefined;
  return {
    beginWork(): void {
      started = true;
    },
    tell(pid: number, event: 'spawn' | 'exit'): void {
      if (event === 'spawn') {
        if (!started || done) return;
        running.add(pid);
        lease.adopt?.(pid);
        return;
      }
      if (!running.delete(pid)) return;
      lease.forget?.(pid);
      if (running.size === 0) allExited?.();
    },
    /** After `work`: no more spawns are this export's; undefined when none of its processes runs. */
    workDone(): Promise<void> | undefined {
      done = true;
      if (running.size === 0) return undefined;
      return new Promise<void>((resolve) => (allExited = resolve));
    },
  };
}
