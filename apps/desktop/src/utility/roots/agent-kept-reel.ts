// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: the template's kept reel as a library asset, for `timeline.assemble`'s slots that keep the reel's own
 * footage (timeline's tools/reel-source.ts). The reel is in the template media store (REF1), which is not the
 * library, and a clip plays a library asset. So the file's bytes go through core's GeneratedAssetSink, the way
 * media the workspace shell made does (tools' import-media.ts): content-addressed, so the same reel is the same
 * asset however often a video is made from it, and recorded as `generated`, generation `workspace`, provider
 * `taalcut`.
 *
 * That is the record the film clips of the old hand recipe got (they came in through workspace.importMedia), and it
 * is kept as it was, not weakened: the asset stays out of the person's library views and out of casting (library's
 * USER_IMPORTED_ASSET_SQL), render's inventory never counts the clip as footage the person shot, and the export's
 * Content Credentials and disclosure reminder count it as not captured. Its model is `reference-reel`, so the
 * record says which kind of workspace media it is.
 *
 * Null when this process has no template media store or no sink, the template keeps no reel, the file is gone, or
 * its first bytes are not MP4 or QuickTime video: assembly then refuses with the fix that fetches the reel again.
 * A file over the sink's limit (500 MB) is the sink's refusal.
 */
import { readFile } from 'node:fs/promises';
import {
  ClockToken,
  GeneratedAssetSinkToken,
  ok,
  TemplateMediaStoreToken,
  type Container,
} from '@taalcut/core';
import type { ReelSource } from '@taalcut/timeline';
import { mediaTypeOf } from '@taalcut/tools';

/** What marks the asset as a template's reel among workspace media. */
export const KEPT_REEL_MODEL = 'reference-reel';

const EXTENSION = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' } as const;

/** Resolved when assembly asks: some roots register the media store and the sink after the tools. */
export function keptReelSource(container: Container): ReelSource {
  return async ({ templateId, projectId, runId }) => {
    if (!container.has(TemplateMediaStoreToken) || !container.has(GeneratedAssetSinkToken)) return ok(null);
    const kept = await container.resolve(TemplateMediaStoreToken).get(templateId);
    if (!kept.ok) return kept;
    if (!kept.value) return ok(null);
    const bytes = await readFile(kept.value.path).catch(() => null);
    if (!bytes) return ok(null);
    const mediaType = mediaTypeOf(bytes);
    if (mediaType !== 'video/mp4' && mediaType !== 'video/quicktime') return ok(null);
    const { sha256 } = kept.value.media;
    const put = await container.resolve(GeneratedAssetSinkToken).put({
      bytes,
      mediaType,
      fileName: `reel-${sha256.slice(0, 16)}.${EXTENSION[mediaType]}`,
      projectId,
      provenance: {
        kind: 'generated',
        generation: 'workspace',
        provider: 'taalcut',
        model: KEPT_REEL_MODEL,
        access: 'local',
        quality: null,
        promptSha256: sha256,
        voiceId: null,
        providerRef: null,
        c2pa: 'unknown',
        costUsd: 0,
        runId,
        createdAt: container.resolve(ClockToken).now(),
      },
    });
    return put.ok ? ok({ assetId: put.value.assetId }) : put;
  };
}
