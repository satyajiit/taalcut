// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Checks that run inside the renderer, shared by the unpackaged launch test
 * (a Playwright Page) and the packaged one (a raw CDP page). Each probe is a
 * self-contained function, serialised into the page like page.evaluate does.
 */
import type { RpcBridge } from '@taalcut/core';
import type { TaalcutProbe } from '../src/placeholder/probe';

declare global {
  interface Window {
    taalcutRpc?: RpcBridge;
    /** The placeholder renderer's client (src/placeholder/probe.ts). */
    taalcutProbe?: TaalcutProbe;
    __inlineScriptRan?: boolean;
  }
}

/** What both a Playwright Page and the CDP client can do. */
export interface Evaluator {
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}

/** typeof of every Node-ish global a compromised page would reach for. */
export function nodeGlobals(page: Evaluator): Promise<Record<string, string>> {
  return page.evaluate(
    (names) => {
      const g = globalThis as Record<string, unknown>;
      return Object.fromEntries(names.map((name) => [name, typeof g[name]]));
    },
    ['require', 'process', 'module', 'exports', 'Buffer', 'global', '__dirname'],
  );
}

/** The keys of window.taalcutRpc, sorted, or null when the preload didn't run. */
export function bridgeKeys(page: Evaluator): Promise<string[] | null> {
  return page.evaluate(() => (window.taalcutRpc ? Object.keys(window.taalcutRpc).sort() : null), undefined);
}

/** Every global the preload added: only taalcutRpc. */
export function preloadGlobals(page: Evaluator): Promise<string[]> {
  return page.evaluate(
    () => Object.keys(window).filter((key) => key.startsWith('taalcut') && key !== 'taalcutProbe'),
    undefined,
  );
}

/** Fetches a same-origin URL from the page and returns status and headers. */
export function fetchFromPage(
  page: Evaluator,
  path: string,
): Promise<{ status: number; contentType: string | null; csp: string | null }> {
  return page.evaluate(async (target) => {
    const response = await fetch(target);
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      csp: response.headers.get('content-security-policy'),
    };
  }, path);
}

/** Whether CSP stops an injected inline script and eval(). */
export function cspBlocks(page: Evaluator): Promise<{ inlineScriptRan: boolean; evalAllowed: boolean }> {
  return page.evaluate(async () => {
    const script = document.createElement('script');
    script.textContent = 'window.__inlineScriptRan = true;';
    document.head.append(script);
    await new Promise((resolve) => setTimeout(resolve, 50));
    let evalAllowed = true;
    try {
      eval('1 + 1');
    } catch {
      evalAllowed = false;
    }
    return { inlineScriptRan: window.__inlineScriptRan === true, evalAllowed };
  }, undefined);
}
