// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The window's uncaught errors and unhandled rejections go to main's `crashes.report` (P2-X5). Main drops
 * them unless crash reports are on, and scrubs each one before it is sent; the page cuts the text to the
 * contract's limits. A report that fails is logged to the console, never reported again.
 */
import { callRpc, type AppClient } from '@taalcut/core';

const MESSAGE_MAX = 2000;
const STACK_MAX = 16_000;

type Crashes = Pick<AppClient['crashes'], 'report'>;
type CrashReport = Parameters<Crashes['report']>[0];
type ErrorTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/** Starts forwarding; the returned function stops it. */
export function forwardWindowErrors(target: ErrorTarget, crashes: Crashes): () => void {
  const send = (report: CrashReport) => {
    void callRpc(crashes.report(report)).then((result) => {
      if (!result.ok) console.warn(`[crashes] a window error was not reported: ${result.error.code}`);
    });
  };
  const onError = (event: ErrorEvent) => send(crashReport('error', event.error, event.message));
  const onRejection = (event: PromiseRejectionEvent) => send(crashReport('unhandledrejection', event.reason));
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

function crashReport(kind: CrashReport['kind'], cause: unknown, fallback?: string): CrashReport {
  const message = cause instanceof Error ? cause.message : (fallback ?? String(cause));
  const stack = cause instanceof Error ? cause.stack : undefined;
  return {
    kind,
    message: message.slice(0, MESSAGE_MAX),
    ...(stack ? { stack: stack.slice(0, STACK_MAX) } : {}),
  };
}
