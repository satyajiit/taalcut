// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where this build reads the hub (docs/release.md `hub.endpoints`). Null on a
 * build that was not given addresses: every call is `hub.not_configured`.
 */
export interface HubEndpoints {
  /** Absolute URL of the static index document (`…/v0/index.json`). */
  readonly indexUrl: string;
  /** Absolute origin of the Worker (`…/v0/…` is appended). */
  readonly workerUrl: string;
}

/** `site/v0/templates/<hubId>.json`, beside the index file. */
export function hubTemplateFileUrl(indexUrl: string, hubId: string): string {
  const url = new URL(indexUrl);
  const directory = url.pathname.endsWith('/') ? url.pathname : url.pathname.replace(/\/[^/]*$/, '/');
  url.pathname = `${directory}templates/${encodeURIComponent(hubId)}.json`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** A Worker route, joined onto `workerUrl` whether or not it has a trailing slash. */
export function hubWorkerUrl(workerUrl: string, path: string): string {
  const base = workerUrl.endsWith('/') ? workerUrl : `${workerUrl}/`;
  return new URL(path.replace(/^\//, ''), base).toString();
}
