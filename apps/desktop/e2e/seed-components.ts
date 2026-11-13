// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Installs components into a test's `<userData>/components` the way the app
 * does (the component manager: sha256, size, extraction, registry), from
 * local files instead of the network. Archives and pinned licence notices come from
 * the component cache, so these tests remain offline; a test without them skips
 * and says which file is missing. The native ones are this machine's build
 * (its platform key, as the app selects artifacts), and a component the
 * manifest has no artifact of for this machine is missing too (LNX1-PKG).
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { createComponentManager, currentPlatform, parseManifest, selectArtifact } from '@taalcut/jobs';
import { desktopDir } from './launch';

const repo = join(desktopDir, '..', '..');

/** Where the packed archives are: TAALCUT_COMPONENT_CACHE, else vision's cache (pack-onnxruntime.sh writes there). */
export const COMPONENT_CACHE =
  process.env.TAALCUT_COMPONENT_CACHE?.trim() || join(repo, 'packages', 'vision', '.cache', 'components');

/** Archives use their packing names; licence notices use the file name in each manifest URL. */
export const LOCAL_ARCHIVES: Readonly<Record<string, string>> = {
  onnxruntime: `onnxruntime-node-1.30.0-${currentPlatform()}.tar.zst`,
  'embeddinggemma-2': 'embeddinggemma-2-onnx-q4-vq4f16-daa72c5.tar.zst',
  'ppocr-v5-devanagari': 'ppocr-v5-devanagari-251aec19-e6f4fa85.tar.zst',
};

function shippedManifest() {
  const json: unknown = JSON.parse(
    readFileSync(join(repo, 'tools', 'components', 'manifest.provisional.json'), 'utf8'),
  );
  const parsed = parseManifest(json);
  if (!parsed.ok) throw new Error(`manifest: ${parsed.error.detail ?? parsed.error.code}`);
  return parsed.value;
}

/** What a seed of `ids` lacks: an artifact for this machine, a file in the cache (empty: it can run). */
export function missingArchives(ids: readonly string[]): string[] {
  const manifest = shippedManifest();
  const platform = currentPlatform();
  const unbuilt = manifest.components
    .filter((component) => ids.includes(component.id) && !selectArtifact(component, platform))
    .map((component) => `${component.id}: no ${platform} artifact in manifest.provisional.json`);
  const files = ids
    .map((id) => join(COMPONENT_CACHE, LOCAL_ARCHIVES[id] ?? `<no local archive for ${id}>`))
    .filter((path) => !existsSync(path));
  const notices = manifest.components
    .filter((component) => ids.includes(component.id) && component.licence.notice)
    .map((component) => join(COMPONENT_CACHE, basename(new URL(component.licence.notice!.url).pathname)))
    .filter((path) => !existsSync(path));
  return [...unbuilt, ...files, ...notices];
}

/** Installs `ids` (and what they depend on) from the shipped manifest's union and the local archives. */
export async function seedComponents(userData: string, ids: readonly string[]): Promise<void> {
  const manifest = shippedManifest();
  // Every url of a component serves its local archive.
  const byUrl = new Map<string, string>();
  for (const component of manifest.components) {
    const file = LOCAL_ARCHIVES[component.id];
    if (!file) continue;
    for (const artifact of component.artifacts)
      for (const url of artifact.urls) byUrl.set(url, join(COMPONENT_CACHE, file));
    const notice = component.licence.notice;
    if (notice) byUrl.set(notice.url, join(COMPONENT_CACHE, basename(new URL(notice.url).pathname)));
  }
  const manager = createComponentManager({
    root: join(userData, 'components'),
    manifest,
    fetch: async (url) => {
      const path = byUrl.get(url);
      if (!path || !existsSync(path)) return new Response(null, { status: 404 });
      const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
      const response = new Response(body, {
        status: 200,
        headers: { 'content-length': String(statSync(path).size) },
      });
      // The downloader checks where a response came from; a made-up Response has no url.
      Object.defineProperty(response, 'url', { value: url });
      return response;
    },
  });
  for (const id of ids) {
    const installed = await manager.install(id);
    if (!installed.ok)
      throw new Error(`${id} not installed: ${installed.error.code} ${installed.error.detail ?? ''}`);
  }
}
