// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The router as the loop sees it (SPEC section 24, P3-B11): the setting a run starts with, and one decision
 * per act turn ("which tool family next, or none?"). createRouteAdvisor implements it over models'
 * Classifier; replay implements it over the run's log, so a replay never calls a router.
 */
import type { ProjectId, RouterSetting } from '@taalcut/core';
import type { RouterAnswerLog } from '../phase3-events';

/** One tool family the router may pick. */
export interface RouteFamily {
  readonly id: string;
  /** One line: what the family does (sent to the router). */
  readonly description: string;
  /** Its tools' one-liners: for on-device routers only, never sent. */
  readonly tools: string;
}

export interface RouteAsk {
  /** The user's message (cut to 2,000 characters). */
  readonly message: string;
  /** What the current step is about. */
  readonly stepText: string;
  /** The step's act turns so far. */
  readonly turn: number;
  /** Families of the run's latest domain tool calls, newest last. */
  readonly lastFamilies: readonly string[];
  /** The conversation's previous message, when the run continues one. */
  readonly previousMessage?: string;
  /** What the router chooses from, besides `none`. */
  readonly families: readonly RouteFamily[];
  readonly signal: AbortSignal;
  readonly trace: { readonly runId: string; readonly spanId: string; readonly projectId?: ProjectId };
}

export type RouteOutcome =
  | { readonly kind: 'answered'; readonly answer: RouterAnswerLog }
  | { readonly kind: 'failed'; readonly errorCode: string }
  /** Replay only: the log recorded a timeout for this decision. */
  | { readonly kind: 'timeout' };

/** How long the loop waits (SPEC section 24). */
export interface RouterTimings {
  /** Shadow: the router is abandoned (and counted a timeout) after this long. Default 2 s. */
  readonly shadowMs: number;
  /** On: the turn waits this long for a live decision, then goes on with the full catalogue. Default 800 ms. */
  readonly liveMs: number;
}

export const DEFAULT_ROUTER_TIMINGS: RouterTimings = { shadowMs: 2_000, liveMs: 800 };

export interface RouteAdvisor {
  /** The rollout setting (core's ROUTER_SETTING), read when a run starts and logged in run.started. */
  setting(): Promise<RouterSetting>;
  decide(ask: RouteAsk): Promise<RouteOutcome>;
  readonly timings: RouterTimings;
  /** Answers come from a log (replay): they are final at once, so the loop waits for them. */
  readonly recorded?: boolean;
}
