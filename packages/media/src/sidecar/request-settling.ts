// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** How a JSON-lines request settles: on the helper's response, or after a cancel (json-line.ts). */
import { err, ok, type Result } from '@taalcut/core';
import { MediaCancelled } from '../errors';
import { SidecarFailed, SidecarRejected } from './errors';
import type { JsonLineMessage, JsonLineRequestOptions, JsonValue } from './json-line-types';
import type { RequestClock } from './request-clock';

const REPLY_GRACE_MS = 120_000;

export interface Pending {
  readonly settle: (result: Result<JsonValue>) => void;
  /** The request's cap and stall wait (request-clock.ts); cleared when it settles. */
  readonly clock?: RequestClock;
  readonly timer?: ReturnType<typeof setTimeout>;
  readonly onNotification?: (message: JsonLineMessage) => void;
}

/**
 * After a cancel: settles now, or (`settleOnReply`) with `outcome` once the helper answers, within its grace. A
 * grace that runs out settles the request and leaves the process running, never signalled; its `onLetGo` waits on
 * for the answer or the exit.
 */
export function settleCancelled(
  pending: Map<string, Pending>,
  id: string,
  method: string,
  options: JsonLineRequestOptions,
  outcome: Result<JsonValue>,
): void {
  const item = pending.get(id);
  if (!item) return;
  item.clock?.clear();
  if (item.timer) clearTimeout(item.timer);
  if (options.settleOnReply !== true) {
    pending.delete(id);
    item.settle(outcome);
    return;
  }
  const silent = () => {
    pending.delete(id);
    const holding = options.onLetGo ? '; what it holds stays held until it answers or exits' : '';
    console.warn(`[media] sidecar ${method}: no answer to a cancel; the process is left running${holding}`);
    item.settle(outcome);
  };
  const timer = setTimeout(silent, options.replyGraceMs ?? REPLY_GRACE_MS);
  pending.set(id, { settle: () => item.settle(outcome), timer });
}

/** A response line as the request's result: the helper's failure codes as media's errors. */
export function responseOf(message: JsonLineMessage): Result<JsonValue> {
  if (message.ok === true) return ok(message.result ?? {});
  const code = message.error?.code ?? 'helper.internal';
  const detail = message.error?.message;
  if (code === 'helper.cancelled') return err(MediaCancelled(undefined, detail ? { detail } : {}));
  if (message.error?.retryable === true) {
    return err(SidecarFailed({ helperCode: code }, detail ? { detail } : {}));
  }
  return err(SidecarRejected({ helperCode: code }, detail ? { detail } : {}));
}
