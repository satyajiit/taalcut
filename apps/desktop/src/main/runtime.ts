// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the renderer comes from and which origins count as "the app".
 * Pure, so the rules are unit-tested without Electron.
 *
 * Environment overrides exist only for development and tests. A packaged build
 * ignores them all: with ASAR integrity on, an environment variable must not
 * be a way to load different code into the window.
 */

export const APP_SCHEME = 'app';
export const APP_HOST = 'taalcut';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_START_URL = `${APP_ORIGIN}/`;

export interface Runtime {
  readonly packaged: boolean;
  /** First page the main window loads: app://taalcut/ or the Vite dev server. */
  readonly startUrl: string;
  /** Origins allowed to navigate the window and to call privileged IPC. */
  readonly trustedOrigins: readonly string[];
  /** Origin of the Vite dev server, when one is used. */
  readonly devServerOrigin: string | undefined;
  readonly devTools: boolean;
}

export interface RuntimeEnv {
  readonly TAALCUT_RENDERER_URL?: string | undefined;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function resolveRuntime(env: RuntimeEnv, packaged: boolean): Runtime {
  if (packaged) {
    return {
      packaged,
      startUrl: APP_START_URL,
      trustedOrigins: [APP_ORIGIN],
      devServerOrigin: undefined,
      devTools: false,
    };
  }
  const devServerOrigin = env.TAALCUT_RENDERER_URL ? devServerOriginOf(env.TAALCUT_RENDERER_URL) : undefined;
  return {
    packaged,
    startUrl: devServerOrigin ? `${devServerOrigin}/` : APP_START_URL,
    trustedOrigins: devServerOrigin ? [APP_ORIGIN, devServerOrigin] : [APP_ORIGIN],
    devServerOrigin,
    devTools: true,
  };
}

/** The dev server must be plain HTTP on loopback; anything else is a configuration bug. */
export function devServerOriginOf(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`TAALCUT_RENDERER_URL is not a URL: ${value}`);
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`TAALCUT_RENDERER_URL must be http://localhost:<port>, got ${value}`);
  }
  return url.origin;
}

/**
 * scheme://host[:port] of a URL, or undefined. Node's URL gives "null" as the
 * origin of non-special schemes such as app:, so it is built by hand.
 */
export function originOf(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!url.host) return undefined;
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

export function isTrustedUrl(value: string, trustedOrigins: readonly string[]): boolean {
  const origin = originOf(value);
  return origin !== undefined && trustedOrigins.includes(origin);
}
