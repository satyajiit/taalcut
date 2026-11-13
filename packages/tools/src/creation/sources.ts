// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CancelledError, defineError, err, ok, type AsyncResult, type CreationSource } from '@taalcut/core';
import { scrubSecrets } from '../scrub';
import type {
  CreationCapture,
  CreationDirectorySnapshot,
  CreationProjectExecution,
  CreationSourceHost,
} from './ports';

export const CreationSourceFailed = defineError('tools.creation_source_failed', { retryable: true });
export const CreationProjectUnsupported = defineError('tools.creation_project_unsupported');
const MAX_CONTENT = 60_000;
const EXCLUDED =
  /(?:^|\/)(?:\.git|node_modules|\.env(?:\..*)?|\.npmrc|\.yarnrc|\.ssh|dist|build|coverage)(?:\/|$)/i;
const DOC = /(?:readme|package\.json|\.md$|\.tsx?$|\.jsx?$|\.html$|\.css$|\.json$)/i;
const LOCKFILE = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i;
function researchPriority(path: string): number {
  if (/(?:^|\/)readme\.[^/]+$/i.test(path)) return 0;
  if (path === 'package.json') return 1;
  if (/(?:^|\/)(?:docs|product|pages|routes)\//i.test(path)) return 2;
  return /\.[jt]sx$/.test(path) ? 3 : 4;
}

/** A source cannot grant access to private network services or smuggle URL credentials into the model. */
export function creationSourceUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.includes(':') ||
      /^(?:0|10|127|169\.254|192\.168)\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
      !host.includes('.')
    )
      return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function planCreationProject(
  snapshot: CreationDirectorySnapshot,
): AsyncResult<CreationProjectExecution> {
  const file = snapshot.files.find((entry) => entry.path === 'package.json');
  if (!file)
    return Promise.resolve(
      err(CreationProjectUnsupported(undefined, { detail: 'No package.json in the selected project.' })),
    );
  try {
    const manifest: unknown = JSON.parse(file.text);
    if (!manifest || typeof manifest !== 'object') throw new Error('manifest');
    const scripts =
      'scripts' in manifest && manifest.scripts && typeof manifest.scripts === 'object'
        ? (manifest.scripts as Record<string, unknown>)
        : {};
    const script = ['dev', 'start', 'preview'].find((name) => typeof scripts[name] === 'string');
    if (!script)
      return Promise.resolve(
        err(CreationProjectUnsupported(undefined, { detail: 'No dev, start or preview script.' })),
      );
    const paths = new Set(snapshot.files.map((entry) => entry.path));
    if (paths.has('yarn.lock') && !paths.has('package-lock.json') && !paths.has('pnpm-lock.yaml'))
      return Promise.resolve(
        err(CreationProjectUnsupported(undefined, { detail: 'Use a running URL for this Yarn project.' })),
      );
    const packageManager = paths.has('pnpm-lock.yaml') ? 'pnpm' : 'npm';
    return Promise.resolve(
      ok({
        snapshotId: snapshot.id,
        packageManager,
        script,
        buildScript: script !== 'dev' && typeof scripts['build'] === 'string' ? 'build' : null,
        install: true,
        timeoutMs: 180_000,
      }),
    );
  } catch {
    return Promise.resolve(err(CreationProjectUnsupported(undefined, { detail: 'Invalid package.json.' })));
  }
}

function captureText(capture: CreationCapture): string {
  return [
    capture.title,
    capture.text,
    ...capture.assets.map((a) => `Asset ${a.assetId}: ${a.label} (${a.mimeType})`),
  ]
    .join('\n')
    .slice(0, MAX_CONTENT);
}

export function createCreationSourceService(host: CreationSourceHost) {
  async function inspect(source: CreationSource, signal: AbortSignal): AsyncResult<CreationSource> {
    if (signal.aborted) return err(CancelledError());
    if (source.kind === 'directory') return directory(source, signal);
    const url = source.kind === 'url' ? creationSourceUrl(source.url ?? '') : null;
    if (source.kind === 'url' && !url)
      return err(CreationSourceFailed(undefined, { detail: 'A public HTTP(S) URL is required.' }));
    const capture =
      source.kind === 'asset' && source.assetId
        ? await host.readAsset(source.assetId, signal)
        : url
          ? await host.captureUrl(url, signal)
          : err(CreationSourceFailed());
    if (!capture.ok) return capture;
    return ok({
      ...source,
      status: 'ready',
      assetIds: capture.value.assets.map((asset) => asset.assetId),
      content: scrubSecrets(captureText(capture.value)),
      evidence: [
        {
          sourceId: source.id,
          locator: url ?? source.assetId ?? source.id,
          summary: scrubSecrets(capture.value.title || source.label),
        },
      ],
    });
  }

  async function directory(source: CreationSource, signal: AbortSignal): AsyncResult<CreationSource> {
    if (!source.accessId)
      return err(CreationSourceFailed(undefined, { detail: 'The directory needs an access grant.' }));
    const snapshot = await host.snapshotDirectory(source.accessId, signal);
    if (!snapshot.ok) return snapshot;
    const files = snapshot.value.files
      .filter((f) => !EXCLUDED.test(f.path) && !LOCKFILE.test(f.path) && DOC.test(f.path))
      .toSorted((a, b) => researchPriority(a.path) - researchPriority(b.path));
    const content = files
      .map((f) => `File: ${f.path}\n${scrubSecrets(f.text).slice(0, 12_000)}`)
      .join('\n\n');
    const plan = await planCreationProject(snapshot.value);
    const capture = plan.ok ? await host.runProject(plan.value, signal) : plan;
    if (signal.aborted) return err(CancelledError());
    const evidence = files.slice(0, 30).map((file) => ({
      sourceId: source.id,
      locator: `${snapshot.value.digest}:${file.path}`,
      summary: `Project file ${file.path}`,
    }));
    return ok({
      ...source,
      status: 'ready',
      assetIds: capture.ok ? capture.value.assets.map((asset) => asset.assetId) : [],
      content: [
        content.slice(0, MAX_CONTENT),
        capture.ok
          ? captureText(capture.value)
          : `Live capture unavailable: ${capture.error.code}. Use the verified files; do not invent product screens.`,
      ]
        .join('\n')
        .slice(0, 100_000),
      evidence,
    });
  }
  return { inspect };
}

export type CreationSourceService = ReturnType<typeof createCreationSourceService>;
