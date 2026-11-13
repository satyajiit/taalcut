// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The preflight half of a brand kit (P3-V10): the Style a render draws, its logo file for the bundle, and its
 * intro and outro resolved (a clip bumper's range probed when the Style gave none; a bumper asset that's gone
 * is skipped and QA warns). The timeline the export renders is the one with the bumpers in place.
 */
import { FrameRate, ok, RationalTime, type AsyncResult, type Style, type Timeline } from '@taalcut/core';
import { probeMedia, type MediaContext } from '@taalcut/media';
import type { AssetFiles } from '../ports';
import { NO_BUMPERS, type PlannedBumpers } from '../plan/types';
import type { BrandAssetFile } from './brand-layers';
import { withBumpers, type ResolvedBumper } from './bumpers';
import type { StyleSource } from './resolve-style';

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;

export interface StyledExport {
  /** The timeline with its bumpers in place (the stored one is unchanged). */
  readonly timeline: Timeline;
  readonly style: Style | null;
  readonly bumpers: PlannedBumpers;
  /** The logo file by sha256, when the Style has one and it is on disk. */
  readonly brandAssets: ReadonlyMap<string, BrandAssetFile>;
}

export interface ExportStyleDeps {
  readonly styles?: StyleSource;
  readonly assets: AssetFiles;
  readonly media: MediaContext;
}

type Bumper = NonNullable<Style['intro']>;

async function resolveBumper(
  deps: ExportStyleDeps,
  bumper: Bumper | null,
): AsyncResult<ResolvedBumper | 'missing' | null> {
  if (!bumper) return ok(null);
  if (bumper.kind === 'card') return ok(bumper);
  const original = await deps.assets.original(bumper.assetId);
  if (!original.ok) return original;
  if (!original.value) return ok('missing');
  if (bumper.range) return ok({ kind: 'clip', assetId: bumper.assetId, range: bumper.range });
  const probe = await probeMedia(original.value.path, deps.media);
  if (!probe.ok || !probe.value.duration) return ok('missing');
  const rate = FrameRate.of(1_000_000);
  const micros = Math.round((probe.value.duration.value * 1_000_000) / probe.value.duration.rate);
  return ok({
    kind: 'clip',
    assetId: bumper.assetId,
    range: { start: RationalTime.zero(rate), duration: RationalTime.of(micros, rate) },
  });
}

async function logoFiles(deps: ExportStyleDeps, style: Style | null): Promise<Map<string, BrandAssetFile>> {
  const files = new Map<string, BrandAssetFile>();
  const logo = style?.logo;
  if (!logo || !deps.styles) return files;
  const path = await deps.styles.assetPath(logo.asset);
  // A logo that's gone draws nothing; brandAssets reports it.
  if (path.ok) files.set(logo.asset, { file: path.value, key: logo.asset, ext: EXTENSIONS[logo.mediaType] });
  return files;
}

export async function styleExport(
  deps: ExportStyleDeps,
  timeline: Timeline,
  includeBumpers: boolean,
): AsyncResult<StyledExport> {
  const resolved = deps.styles ? await deps.styles.styleFor(timeline) : ok(null);
  if (!resolved.ok) return resolved;
  const style = resolved.value;
  const brandAssets = await logoFiles(deps, style);
  if (!style || !includeBumpers) return ok({ timeline, style, bumpers: NO_BUMPERS, brandAssets });
  const intro = await resolveBumper(deps, style.intro);
  if (!intro.ok) return intro;
  const outro = await resolveBumper(deps, style.outro);
  if (!outro.ok) return outro;
  const missing = [
    ...(intro.value === 'missing' ? (['intro'] as const) : []),
    ...(outro.value === 'missing' ? (['outro'] as const) : []),
  ];
  const placed = withBumpers(timeline, {
    intro: intro.value === 'missing' ? null : intro.value,
    outro: outro.value === 'missing' ? null : outro.value,
    missing,
  });
  if (!placed.ok) return placed;
  return ok({ timeline: placed.value.timeline, style, bumpers: placed.value.bumpers, brandAssets });
}
