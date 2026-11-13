// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FCPXML resources (P3-V5): the sequence's format (the canvas: 1080 × 1920 at its rate), one format per distinct
 * media rate and size, and one asset per original with its range and audio facts (Apple asks for those so an
 * offline asset still imports right) and a `media-rep` naming its file. Ids are `r1`, `r2`… in first-use order,
 * so the same timeline always writes the same file.
 */
import type { AssetId, FrameRate, InterchangeMedia, MediaRef, Timeline, TimeRange } from '@taalcut/core';
import type { InterchangeContext } from '../exporter';
import { clipMedia, fileUrl, timelineAssets, writtenMedia } from '../media-paths';
import { framesToSeconds, timeToSeconds, ZERO, type Seconds } from '../seconds';
import { fcpTime, frameDuration } from './time';
import { element, type XmlNode } from './xml';

export type AssetKind = 'video' | 'image' | 'audio';

/** The asset's Taalcut id, in its metadata: how a read-back (and a later re-import) knows which asset it is. */
export const ASSET_ID_KEY = 'com.taalcut.assetId';

export interface FcpAsset {
  readonly id: string;
  readonly assetId: AssetId;
  readonly kind: AssetKind;
  readonly hasAudio: boolean;
}

export interface FcpResources {
  readonly sequenceFormat: string;
  readonly assets: ReadonlyMap<AssetId, FcpAsset>;
  readonly nodes: readonly XmlNode[];
}

/** The first media reference each asset is used with: its kind and its full range. */
function firstUses(timeline: Timeline): Map<AssetId, MediaRef> {
  const uses = new Map<AssetId, MediaRef>();
  for (const media of clipMedia(timeline)) if (!uses.has(media.assetId)) uses.set(media.assetId, media);
  return uses;
}

const flag = (value: boolean) => (value ? '1' : '0');
const count = (value: number | null) => (value === null ? null : String(value));

type Attributes = Record<string, string | null>;

/**
 * Ids `r1`, `r2`… handed out in first-use order across formats and assets (an asset's format before the asset), and
 * one format per distinct rate and size.
 */
interface ResourceTable {
  nextId(): string;
  format(rate: FrameRate | null, width: number | null, height: number | null): string;
  readonly formatNodes: XmlNode[];
}

function createResourceTable(): ResourceTable {
  let next = 1;
  const nextId = () => `r${next++}`;
  const formats = new Map<string, string>();
  const formatNodes: XmlNode[] = [];
  const format = (rate: FrameRate | null, width: number | null, height: number | null): string => {
    const key = `${rate ? `${rate.num}/${rate.den}` : 'still'}:${width ?? '?'}x${height ?? '?'}`;
    const known = formats.get(key);
    if (known) return known;
    const id = nextId();
    formats.set(key, id);
    formatNodes.push(
      element('format', {
        id,
        name: rate ? null : 'FFVideoFormatRateUndefined',
        frameDuration: rate ? frameDuration(rate) : null,
        width: count(width),
        height: count(height),
      }),
    );
    return id;
  };
  return { nextId, format, formatNodes };
}

/** What an asset is written from: how the timeline first uses it and what the library knows of its original. */
interface AssetFacts {
  readonly kind: AssetKind;
  readonly use: MediaRef | undefined;
  readonly media: InterchangeMedia | undefined;
  readonly hasAudio: boolean;
}

/** A still: no time of its own, a rate-less format of its size, no sound. */
function imageAttributes({ media }: AssetFacts, table: ResourceTable): Attributes {
  return {
    start: fcpTime(ZERO),
    duration: fcpTime(ZERO),
    hasVideo: '1',
    format: table.format(null, media?.width ?? null, media?.height ?? null),
    hasAudio: '0',
  };
}

/** The asset's length: the media range a clip names, else the original's frame count at its rate, else unknown. */
function assetDuration(available: TimeRange | null, media: InterchangeMedia | undefined): Seconds | null {
  if (available) return timeToSeconds(available.duration);
  const known = media?.durationFrames ?? null;
  return known !== null && media?.rate ? framesToSeconds(known, media.rate) : null;
}

/** A video or an audio file: its range, its format (video) and its sound (Apple asks for those when offline). */
function timedAttributes(facts: AssetFacts, table: ResourceTable): Attributes {
  const { kind, use, media, hasAudio } = facts;
  const available = use && use.kind !== 'image' ? use.available : null;
  const rate = available?.start.rate ?? media?.rate ?? null;
  const duration = assetDuration(available, media);
  return {
    start: fcpTime(available ? timeToSeconds(available.start) : ZERO),
    duration: duration ? fcpTime(duration) : null,
    hasVideo: flag(kind === 'video'),
    format: kind === 'video' ? table.format(rate, media?.width ?? null, media?.height ?? null) : null,
    hasAudio: flag(hasAudio),
    audioSources: hasAudio ? '1' : null,
    audioChannels: hasAudio ? count(media?.audioChannels ?? 2) : null,
    audioRate: hasAudio ? count(media?.audioRate ?? 48000) : null,
  };
}

function assetFacts(assetId: AssetId, use: MediaRef | undefined, context: InterchangeContext): AssetFacts {
  const media = context.media.get(assetId);
  const kind: AssetKind = use ? use.kind : 'audio';
  return { kind, use, media, hasAudio: kind === 'audio' || (media?.hasAudio ?? false) };
}

export function buildResources(timeline: Timeline, context: InterchangeContext): FcpResources {
  const table = createResourceTable();
  const canvas = timeline.canvas;
  const sequenceFormat = table.format(canvas.rate, canvas.width, canvas.height);
  const uses = firstUses(timeline);
  const assets = new Map<AssetId, FcpAsset>();
  const assetNodes: XmlNode[] = [];
  for (const assetId of timelineAssets(timeline)) {
    const facts = assetFacts(assetId, uses.get(assetId), context);
    const attrs = facts.kind === 'image' ? imageAttributes(facts, table) : timedAttributes(facts, table);
    const written = writtenMedia(assetId, context.media, 'fileUrl');
    const id = table.nextId();
    assets.set(assetId, { id, assetId, kind: facts.kind, hasAudio: facts.hasAudio });
    assetNodes.push(
      element('asset', { id, name: written.name, ...attrs }, [
        element('media-rep', { kind: 'original-media', src: written.target ?? fileUrl(written.name) }),
        element('metadata', {}, [element('md', { key: ASSET_ID_KEY, value: assetId })]),
      ]),
    );
  }
  return { sequenceFormat, assets, nodes: [...table.formatNodes, ...assetNodes] };
}

/** The asset written for a timeline asset; every clip's asset is written, so a miss is a bug. */
export function assetOf(resources: FcpResources, assetId: AssetId): FcpAsset {
  const asset = resources.assets.get(assetId);
  if (!asset) throw new Error(`FCPXML resources have no asset for ${assetId}`);
  return asset;
}
