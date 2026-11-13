// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * In-engine CDP runtime telemetry for `workspace.frames` (WP-HFW-3D-CDP):
 * captures uncaught page exceptions, `console.error` events, and WebGL/Three.js
 * context or shader failures during headless-shell frame capture, turning them
 * into actionable `CompositionGateCheck` feedback (`id: 'runtimeErrors'`).
 */
import type { CompositionGateCheck } from '@taalcut/core';

export interface RuntimeErrorRecord {
  readonly kind: 'pageerror' | 'console.error' | 'webgl';
  readonly message: string;
}

export interface PageDiagnostics {
  readonly errors: RuntimeErrorRecord[];
  recordWebglErrors(messages: readonly string[]): void;
}

interface TelemetryPage {
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** Page expression reading any in-page WebGL / Three.js error messages recorded by `TC_THREE_RUNTIME_JS`. */
export const RUNTIME_ERRORS_PROBE = `(() => Array.isArray(window.__tcThreeErrors) ? window.__tcThreeErrors.slice(0, 10) : [])()`;

function formatConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && 'text' in arg && typeof (arg as { text?: unknown }).text === 'function') {
    try {
      return String((arg as { text: () => string }).text());
    } catch {
      return String(arg);
    }
  }
  if (arg instanceof Error) return arg.message;
  return String(arg);
}

/** Benign network-blocked console noise already reported by the `network` gate check. */
function isBlockedNetworkNoise(message: string): boolean {
  return message.includes('ERR_BLOCKED_BY_CLIENT') || message.includes('Failed to load resource');
}

export function attachPageDiagnostics(page: unknown): PageDiagnostics {
  const errors: RuntimeErrorRecord[] = [];
  const target = page as TelemetryPage | null | undefined;

  if (target && typeof target.on === 'function') {
    target.on('pageerror', (errObj: unknown) => {
      const message = errObj instanceof Error ? errObj.message : String(errObj);
      if (message && errors.length < 25) {
        errors.push({ kind: 'pageerror', message: message.slice(0, 300) });
      }
    });

    target.on('console', (msg: unknown) => {
      const msgObj = msg as { type?: () => string; text?: () => string } | null;
      const type = typeof msgObj?.type === 'function' ? msgObj.type() : '';
      if (type !== 'error') return;
      const message = formatConsoleArg(msg).trim();
      if (!message || isBlockedNetworkNoise(message)) return;
      if (errors.length < 25) {
        errors.push({ kind: 'console.error', message: message.slice(0, 300) });
      }
    });
  }

  return {
    errors,
    recordWebglErrors(messages: readonly string[]) {
      for (const msg of messages) {
        const clean = String(msg).trim();
        if (clean && errors.length < 25) {
          errors.push({ kind: 'webgl', message: clean.slice(0, 300) });
        }
      }
    },
  };
}

export function runtimeErrorsCheck(diagnostics: Pick<PageDiagnostics, 'errors'>): CompositionGateCheck {
  if (diagnostics.errors.length === 0) {
    return { id: 'runtimeErrors', status: 'pass' };
  }
  const summary = diagnostics.errors
    .slice(0, 3)
    .map((entry) => `[${entry.kind}] ${entry.message}`)
    .join('; ');
  return {
    id: 'runtimeErrors',
    status: 'fail',
    detail: `the page threw runtime errors during frame capture: ${summary}. Fix uncaught JS/WebGL errors so every seek renders cleanly.`.slice(
      0,
      500,
    ),
  };
}
