// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A checkout's components from a local release (UX3-IDX). `TAALCUT_DEV_COMPONENTS=<release folder>` (the folder
 * `tools/components/hosting/build.mjs --pending` writes: `release.json` and `objects/<id>/<version>/<file>`) makes
 * the jobs process's component manager use the pending manifest (`compose-provisional.mjs`'s
 * `compose(undefined, { pending: true })`, the hosted union plus the builds not hosted yet) instead of the signed
 * one, with every file the release lists served from a loopback server. Several folders, separated like PATH
 * (`<release>:<rebuild>`), are one release: a later folder's file wins (a partial rebuild over a full release, such
 * as LNX1-TRM's cuda-runtime-13 NOTICE over LNX1-CMP's).
 *
 * - A file the release holds is fetched from the loopback server, whatever its hosted address.
 * - A file it doesn't hold keeps its hosted address when the shipped (hosted) union has it: the models the release
 *   doesn't rebuild (Whisper, EmbeddingGemma) still come from components.taalcut.app.
 * - A pending build the release doesn't hold isn't hosted anywhere, so it is left out (that platform's artifact,
 *   and a component left with none, and anything that needs it). Its install says it isn't available here.
 *
 * The server answers only for the objects the folders' `release.json` list. The manager checks every download's size
 * and sha256 against this manifest as it does any other, so a file changed on disk fails its install. What is
 * skipped is the manifest's signature: that is why only a development build takes it. A packaged app refuses to
 * start with the variable set (security/switches.ts, risk `unsigned-components`, in test builds too), and the jobs
 * process ignores it when packaged (devComponentSource), saying so in its log; the signed manifest's checks are
 * unchanged either way.
 */
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { delimiter, dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { ManifestInvalid, parseManifest, type ComponentManifest } from '@taalcut/jobs';

/** The variable a development run names its local release in. */
export const DEV_COMPONENTS_ENV = 'TAALCUT_DEV_COMPONENTS';
/** Where the manifests point every hosted file. */
export const PUBLIC_BASE = 'https://components.taalcut.app/';

export type DevComponentSource =
  | { readonly kind: 'off' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'on'; readonly releaseDirs: readonly string[] };

/** Whether this run installs from a local release: never in a packaged app. */
export function devComponentSource(
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): DevComponentSource {
  const named = env[DEV_COMPONENTS_ENV]?.trim();
  if (!named) return { kind: 'off' };
  if (packaged)
    return {
      kind: 'refused',
      reason: `${DEV_COMPONENTS_ENV} is ignored: a packaged app installs only from its signed manifest`,
    };
  const releaseDirs = named
    .split(delimiter)
    .filter((part) => part.trim() !== '')
    .map((part) => resolve(part.trim()));
  return { kind: 'on', releaseDirs };
}

/** Whether runtimes come only from installed components: a packaged app, or a run installing from a release. */
export function managedNativesOnly(
  packaged: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return packaged || devComponentSource(env, packaged).kind === 'on';
}

interface ManifestJson {
  readonly components: readonly ComponentJson[];
  readonly [field: string]: unknown;
}
interface ComponentJson {
  readonly id: string;
  readonly artifacts: readonly { readonly urls: readonly string[]; readonly [field: string]: unknown }[];
  readonly dependencies?: readonly string[];
  readonly variants?: readonly string[];
  readonly [field: string]: unknown;
}

export interface LocalReleaseInput {
  /** The pending union (compose(undefined, { pending: true })). */
  readonly pending: ManifestJson;
  /** The hosted union (compose()): what components.taalcut.app serves. */
  readonly hosted: ManifestJson;
  /** Whether the release holds this object key (`<id>/<version>/<file>`). */
  readonly holds: (key: string) => boolean;
  /** The loopback server's base, ending in `/`. */
  readonly base: string;
}

/** The pending manifest pointed at the release where it holds a file; see the module comment. Pure. */
export function localReleaseManifest(input: LocalReleaseInput): {
  manifest: ManifestJson;
  local: number;
  dropped: string[];
} {
  const keyOf = (url: string) => (url.startsWith(PUBLIC_BASE) ? url.slice(PUBLIC_BASE.length) : undefined);
  const held = (url: string) => {
    const key = keyOf(url);
    return key !== undefined && input.holds(key);
  };
  const hostedUrls = new Set(
    input.hosted.components.flatMap((component) => component.artifacts.flatMap((artifact) => artifact.urls)),
  );
  const dropped: string[] = [];
  let components = input.pending.components.map((component) => {
    const artifacts = component.artifacts.filter((artifact) =>
      artifact.urls.some((url) => held(url) || hostedUrls.has(url)),
    );
    if (artifacts.length < component.artifacts.length)
      dropped.push(
        ...component.artifacts
          .filter((artifact) => !artifacts.includes(artifact))
          .map((artifact) => `${component.id} ${String(artifact['platform'])}`),
      );
    return { ...component, artifacts };
  });
  // A component left with no artifact goes, and so does anything that needs it; a variant list loses it.
  for (let changed = true; changed;) {
    const ids = new Set(components.filter((c) => c.artifacts.length > 0).map((c) => c.id));
    const kept = components.filter(
      (c) => c.artifacts.length > 0 && (c.dependencies ?? []).every((dependency) => ids.has(dependency)),
    );
    changed = kept.length < components.length;
    components = kept.map((c) =>
      c.variants ? { ...c, variants: c.variants.filter((id) => ids.has(id)) } : c,
    );
  }
  let local = 0;
  const point = (value: unknown): unknown => {
    if (typeof value === 'string' && held(value)) {
      local += 1;
      return `${input.base}${keyOf(value)}`;
    }
    if (Array.isArray(value)) return value.map(point);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, point(inner)]));
    return value;
  };
  return { manifest: { ...input.pending, components: point(components) as ComponentJson[] }, local, dropped };
}

export interface Loopback {
  readonly base: string;
  readonly requests: string[];
  close(): Promise<void>;
}

/**
 * Serves files on 127.0.0.1 (GET and HEAD, single byte ranges): `fileFor` maps a request's path (decoded, without its
 * leading slash, never climbing out with `..`) to a file, or undefined for 404.
 */
export async function serveFiles(fileFor: (path: string) => string | undefined): Promise<Loopback> {
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).slice(1);
      requests.push(`${req.method ?? 'GET'} /${path}${req.headers.range ? ` ${req.headers.range}` : ''}`);
      if (path.startsWith('..') || isAbsolute(path)) return res.writeHead(403).end();
      const file = fileFor(path);
      const info = file ? await stat(file).catch(() => undefined) : undefined;
      if (!file || !info?.isFile()) return res.writeHead(404).end();
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Number(range[2]) : info.size - 1;
      const headers = {
        'content-length': String(end - start + 1),
        'accept-ranges': 'bytes',
        etag: `"${info.size}-${info.mtimeMs}"`,
        ...(range ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}),
      };
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD') return res.end();
      createReadStream(file, { start, end }).pipe(res);
    })();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/`,
    requests,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/** Serves everything under `dir` (LNX1-CMP's host check serves a release's objects/ so). */
export function serveDirectory(dir: string): Promise<Loopback> {
  return serveFiles((path) => join(dir, path));
}

/** The objects the folders' release.json list, by key, each at its file; a later folder's wins. */
async function releaseObjects(releaseDirs: readonly string[]): Promise<Map<string, string> | string> {
  const files = new Map<string, string>();
  for (const dir of releaseDirs) {
    const listed = await readFile(join(dir, 'release.json'), 'utf8').then(
      (text) => JSON.parse(text) as { objects?: unknown },
      () => undefined,
    );
    if (!listed || !Array.isArray(listed.objects)) return `${dir} has no readable release.json`;
    for (const object of listed.objects as { key?: unknown }[]) {
      const key = typeof object.key === 'string' ? normalize(object.key) : '';
      const file = join(dir, 'objects', key);
      if (key && !key.startsWith('..') && !isAbsolute(key) && existsSync(file)) files.set(key, file);
    }
  }
  return files;
}

type Compose = (read?: undefined, options?: { pending?: boolean }) => ManifestJson;

export interface DevComponents {
  readonly manifest: ComponentManifest;
  readonly base: string;
  close(): Promise<void>;
}

const failed = (detail: string) => err(ManifestInvalid(undefined, { detail }));

/**
 * Serves the release and builds its manifest. `manifestPath` is the checkout's
 * `tools/components/manifest.signed.json` (shared/component-manifest.ts), so compose-provisional.mjs is beside it.
 */
export async function startDevComponents(options: {
  readonly releaseDirs: readonly string[];
  readonly manifestPath: string;
  readonly log: (message: string) => void;
}): AsyncResult<DevComponents> {
  const { releaseDirs, log } = options;
  const files = await releaseObjects(releaseDirs);
  if (typeof files === 'string') return failed(`${DEV_COMPONENTS_ENV}: ${files}`);
  const composer = join(dirname(options.manifestPath), 'compose-provisional.mjs');
  if (!existsSync(composer)) return failed(`${DEV_COMPONENTS_ENV}: ${composer} is missing`);
  const { compose } = (await import(pathToFileURL(composer).href)) as { compose: Compose };
  const server = await serveFiles((path) => files.get(path));
  const built = localReleaseManifest({
    pending: compose(undefined, { pending: true }),
    hosted: compose(),
    holds: (key) => files.has(key),
    base: server.base,
  });
  const parsed = parseManifest(built.manifest);
  if (!parsed.ok) {
    await server.close();
    return failed(`${DEV_COMPONENTS_ENV}: the pending manifest didn't parse: ${parsed.error.detail ?? ''}`);
  }
  log(
    `[components] ${DEV_COMPONENTS_ENV}: the pending manifest, unsigned (development run only), ` +
      `${built.local} files from ${releaseDirs.join(', ')} at ${server.base}, the rest from ${PUBLIC_BASE}` +
      (built.dropped.length > 0 ? `; not in this release: ${built.dropped.join(', ')}` : ''),
  );
  return ok({ manifest: parsed.value, base: server.base, close: () => server.close() });
}
