// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Stand-in routers and a slow model for the router tests: no network, no models package classifier. */
import { ROUTER_SETTING, type RouterSetting } from '@taalcut/core';
import {
  createScriptedModelClient,
  DEFAULT_ROUTER_TIMINGS,
  type ModelScript,
  type RouteAdvisor,
  type RouteAsk,
  type RouteOutcome,
  type RouterTimings,
} from '@taalcut/agent';
import type { ModelClient, ModelRequest, ModelStream } from '@taalcut/models';

export const setting = (patch: Partial<RouterSetting>): RouterSetting => ({
  ...ROUTER_SETTING.defaultValue,
  ...patch,
});

export const answered = (choice: string, confidence = 0.9): RouteOutcome => ({
  kind: 'answered',
  answer: {
    choice,
    top3: [{ option: choice, probability: confidence }],
    confidence,
    model: 'stand-in/router-1',
    latencyMs: 1,
    costUsd: 0.00002,
  },
});

export interface StubRouter extends RouteAdvisor {
  readonly asks: RouteAsk[];
  /** Asks whose signal was aborted (the loop gave up on them). */
  readonly aborted: RouteAsk[];
}

/** A router that answers with `decide` (after `delayMs`, or never when delayMs is Infinity: until aborted). */
export function stubRouter(
  value: RouterSetting,
  decide: (ask: RouteAsk, index: number) => RouteOutcome,
  options: { readonly delayMs?: number; readonly timings?: Partial<RouterTimings> } = {},
): StubRouter {
  const asks: RouteAsk[] = [];
  const aborted: RouteAsk[] = [];
  return {
    asks,
    aborted,
    timings: { ...DEFAULT_ROUTER_TIMINGS, ...options.timings },
    setting: async () => value,
    decide(ask) {
      const index = asks.length;
      asks.push(ask);
      ask.signal.addEventListener('abort', () => aborted.push(ask), { once: true });
      const delay = options.delayMs ?? 0;
      if (delay === 0) return Promise.resolve(decide(ask, index));
      return new Promise((resolve) => {
        const timer = Number.isFinite(delay)
          ? setTimeout(() => resolve(decide(ask, index)), delay)
          : undefined;
        ask.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve({ kind: 'failed', errorCode: 'core.cancelled' });
        });
      });
    },
  };
}

/** A scripted model whose every answer takes `ms`. */
export function slowModel(
  script: ModelScript,
  ms: number,
): ModelClient & { readonly requests: ModelRequest[] } {
  const inner = createScriptedModelClient(script);
  const wait = () => new Promise((resolve) => setTimeout(resolve, ms));
  const client = {
    requests: inner.requests,
    stream(request: ModelRequest): ModelStream {
      const stream = inner.stream(request);
      return {
        async *[Symbol.asyncIterator]() {
          await wait();
          yield* stream;
        },
        result: () => stream.result(),
      };
    },
    complete(request: ModelRequest) {
      return client.stream(request).result();
    },
  };
  return client;
}
