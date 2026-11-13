// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One running model process (or the eval's thread), as the jobs process sees it (IX2-S2): opens the model by
 * its folder, sends windows and matches the answers by id. Everything that ends it ends it once: the model
 * failing to open or not saying it is ready within `startMs` (the client stops waiting and lets it go), a
 * message outside the protocol, the process or port going away (a crash), or a release. Windows in flight when
 * it is lost, and every window after, fail as `vision.shot_model_failed`, so the job falls back to scdet.
 */
import {
  CancelledError,
  err,
  ok,
  raceAbort,
  type AsyncResult,
  type ComputeBackend,
  type ComputeFallbackEvent,
  type Result,
  type TaalcutError,
} from '@taalcut/core';
import { ShotModelFailed } from '../errors';
import type { ShotModelRuntime } from './backends';
import { fromModelSchema, type FromModel, type ToModel } from './model-protocol';
import type { WindowOutput } from './windows';

/** The client's end of a channel to the model's process or thread. */
export interface ModelChannel {
  send(message: ToModel): void;
  onMessage(listener: (raw: unknown) => void): void;
  /** Once, when the other side is gone (it exited or crashed, its port closed); the detail says how. */
  onGone(listener: (detail: string) => void): void;
  /** Lets the other side go: closes the port, or disconnects; the model then ends on its own. */
  close(): void;
}

/** setTimeout and clearTimeout, injected so the lifecycle is tested without waiting. */
export interface ModelTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimers: ModelTimers = {
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    // A timer of the model's never keeps the process alive on its own.
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SessionOptions {
  readonly modelDir: string;
  /** How long the model may take to say it is ready. */
  readonly startMs: number;
  /** The longest a release waits for the model to say it has let go. */
  readonly releaseMs?: number;
  readonly timers: ModelTimers;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** Where the model's process opens it (the jobs process's probe); absent: its platform's row. */
  readonly runtime?: ShotModelRuntime;
}

/** The model the process opened and the provider it opened on. */
export interface OpenedModel {
  readonly model: string;
  readonly backend: ComputeBackend;
}

export interface ModelSession {
  /** The model, once the process says it is ready (or why it never will be). */
  readonly opened: Promise<Result<OpenedModel>>;
  /** Windows sent and not answered yet. */
  readonly inFlight: number;
  ask(window: Float32Array, signal?: AbortSignal): AsyncResult<WindowOutput>;
  /** Asks the model to let go, then closes the channel; resolves once it has (or after `releaseMs`). */
  release(): Promise<void>;
  /** Called once when the session ends; `lost` is the failure when it didn't end by a release. */
  onEnd(listener: (lost: TaalcutError | undefined) => void): void;
}

const failed = (detail: string) => ShotModelFailed(undefined, { detail });

/** A session's end, once: why (undefined after a release), told to every listener, late ones too. */
export class SessionEnd {
  private state: { readonly lost: TaalcutError | undefined } | undefined;
  private readonly listeners: ((lost: TaalcutError | undefined) => void)[] = [];

  /** Undefined while the session runs. */
  get ended(): { readonly lost: TaalcutError | undefined } | undefined {
    return this.state;
  }

  /** Ends it and tells the listeners; false when it had already ended. */
  end(lost: TaalcutError | undefined): boolean {
    if (this.state) return false;
    this.state = { lost };
    for (const listener of this.listeners.splice(0)) listener(lost);
    return true;
  }

  onEnd(listener: (lost: TaalcutError | undefined) => void): void {
    if (this.state) listener(this.state.lost);
    else this.listeners.push(listener);
  }
}
const RELEASED = 'the model was released';

type Reply = (out: Result<WindowOutput>) => void;

class Session implements ModelSession {
  readonly opened: Promise<Result<OpenedModel>>;
  private settle: (result: Result<OpenedModel>) => void = () => undefined;
  private readonly replies = new Map<number, Reply>();
  private readonly startTimer: unknown;
  private next = 0;
  private readonly ending = new SessionEnd();
  private releasing: { readonly done: Promise<void>; readonly resolve: () => void } | undefined;

  constructor(
    private readonly channel: ModelChannel,
    private readonly options: SessionOptions,
  ) {
    this.opened = new Promise((resolve) => (this.settle = resolve));
    this.startTimer = options.timers.setTimeout(
      () => this.end(failed(`the model did not say it was ready within ${options.startMs} ms`)),
      options.startMs,
    );
    channel.onMessage((raw) => {
      const parsed = fromModelSchema.safeParse(raw);
      if (parsed.success) this.receive(parsed.data);
      else this.end(failed(`the model sent ${parsed.error.message}`));
    });
    channel.onGone((detail) => this.end(failed(detail)));
    const { runtime } = options;
    channel.send({
      type: 'open',
      modelDir: options.modelDir,
      ...(runtime ? { ...runtime, devices: [...runtime.devices] } : {}),
    });
  }

  get inFlight(): number {
    return this.replies.size;
  }

  async ask(window: Float32Array, signal?: AbortSignal): AsyncResult<WindowOutput> {
    const ready = await raceAbort(this.opened, signal);
    if (signal?.aborted) return err(CancelledError());
    if (!ready.ok) return ready;
    const { ended } = this.ending;
    if (ended) return err(ended.lost ?? failed(RELEASED));
    return new Promise((resolve) => {
      const id = this.next++;
      const abort = () => {
        // The model finishes the window anyway; its answer finds no one waiting.
        this.replies.delete(id);
        resolve(err(CancelledError()));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.replies.set(id, (out) => {
        signal?.removeEventListener('abort', abort);
        resolve(out);
      });
      this.channel.send({ type: 'predict', id, window });
    });
  }

  release(): Promise<void> {
    if (this.ending.ended) return Promise.resolve();
    if (!this.releasing) {
      let resolve: () => void = () => undefined;
      const done = new Promise<void>((r) => (resolve = r));
      const timer = this.options.timers.setTimeout(() => this.end(undefined), this.options.releaseMs ?? 5000);
      this.releasing = {
        done,
        resolve: () => {
          this.options.timers.clearTimeout(timer);
          resolve();
        },
      };
      this.channel.send({ type: 'release' });
    }
    return this.releasing.done;
  }

  onEnd(listener: (lost: TaalcutError | undefined) => void): void {
    this.ending.onEnd(listener);
  }

  private receive(message: FromModel): void {
    if (message.type === 'fallback') this.options.onFallback?.(message.event);
    else if (message.type === 'ready') {
      this.options.timers.clearTimeout(this.startTimer);
      this.settle(ok({ model: message.model, backend: message.backend }));
    } else if (message.type === 'failed') this.end(message.error);
    else if (message.type === 'released') this.end(undefined);
    else {
      const reply = this.replies.get(message.id);
      this.replies.delete(message.id);
      const { type } = message;
      reply?.(
        type === 'output' ? ok({ single: message.single, manyHot: message.manyHot }) : err(message.error),
      );
    }
  }

  /** Ends the session once: whatever ended it, the job sees the model failing (its scdet fallback). */
  private end(cause: TaalcutError | undefined): void {
    const lost =
      cause && cause.code !== 'vision.shot_model_failed'
        ? failed(`${cause.code}: ${cause.detail ?? ''}`)
        : cause;
    if (!this.ending.end(lost)) return;
    this.options.timers.clearTimeout(this.startTimer);
    const gone = err(lost ?? failed(RELEASED));
    this.settle(gone);
    for (const reply of this.replies.values()) reply(gone);
    this.replies.clear();
    this.releasing?.resolve();
    this.channel.close();
  }
}

export function openSession(channel: ModelChannel, options: SessionOptions): ModelSession {
  return new Session(channel, options);
}
