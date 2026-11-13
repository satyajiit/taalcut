// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hits on cuts as `sfx.setHits` payloads (SPEC P3.6): `addHits` plans from the bundled pack and adds each sound it
 * uses to the library (provenance `bundled`, CC0, its source kept; the library dedupes by content); `generateHit`
 * asks the SfxProvider for one new sound (0.5–4 s) and places it on the given cuts. Spoken voiceover is the voice
 * track's clips, so a cut inside a line is skipped unless the style is punchy.
 */
import { readFile } from 'node:fs/promises';
import {
  err,
  ok,
  type AssetId,
  type AsyncResult,
  type SfxCategory,
  type SfxHit,
  type Timeline,
} from '@taalcut/core';
import { trackOfRole } from '../commands/audio-track';
import { createSpectrogramRunner, type SpectrogramRunner } from '../listen/dsp/spectrogram-graph';
import type { TimeStretcher } from '../stretch/stretcher';
import { bankHits } from './bank-plan';
import { sfxBankSource } from './bank-source';
import type { KitPreset } from './kits/presets';
import { frameMs, timelineMs } from '../timeline/span';
import { timelineCuts } from './cuts';
import { SfxNoFittingCuts, SfxPackMissing } from './errors';
import { generateHit, type GenerateHitDeps, type GenerateHitRequest } from './generate-hit';
import { planHits, type HitDensity, type HitStyle, type Span } from './hit-plan';
import { toHits } from './hit-records';
import type { SfxPack, SfxPackItem } from './pack-catalogue';

/** The installed `sfx-pack` component (desktop resolves its folder). */
export interface SfxPackSource {
  load(): AsyncResult<SfxPack>;
}

export interface SfxServiceDeps extends GenerateHitDeps {
  readonly pack: SfxPackSource;
  /** EAR1-D2: where the `sfx-bank` component is installed now (null: not installed), for hits from bank sounds. */
  readonly bankDir?: () => string | null | undefined;
  /** EAR1-D3: a kit take's pitch and reshaped length. */
  readonly stretcher?: TimeStretcher;
}

export interface HitsOutcome {
  readonly payload: {
    projectId: Timeline['projectId'];
    timelineId: Timeline['id'];
    revision: number;
    hits: SfxHit[];
  };
  readonly costUsd: number;
}

/** Spoken voiceover on the timeline, ms: each voice clip from half a frame in to its end. */
export function voiceSpeech(timeline: Timeline): Span[] {
  const track = trackOfRole(timeline, 'voice');
  const frame = frameMs(timeline);
  const spans: Span[] = [];
  let at = 0;
  for (const item of track?.items ?? []) {
    if (item.type === 'transition') continue;
    if (item.type === 'clip')
      spans.push({ startMs: (at + 0.5) * frame, endMs: (at + item.duration.value) * frame });
    at += item.duration.value;
  }
  return spans;
}

export interface AddHitsRequest {
  readonly timeline: Timeline;
  readonly density?: HitDensity;
  readonly style?: HitStyle;
  /** EAR1-D2: bank sounds to place instead of the v1 pack (Taalcut or earshot ids). */
  readonly soundIds?: readonly string[];
  /** EAR1-D3: a kit preset's name or a kit file; its roles serve the cuts the asked-for sounds don't. */
  readonly kit?: KitPreset | unknown;
  /** EAR1-D3: which kit role serves each cut category. */
  readonly roles?: Partial<Record<SfxCategory, string>>;
  readonly signal?: AbortSignal;
}

export function createSfxService(deps: SfxServiceDeps) {
  const bankSource = sfxBankSource(deps.bankDir ?? (() => null));
  let runner: SpectrogramRunner | undefined;
  const bankRunner = () =>
    (runner ??= createSpectrogramRunner(
      deps.media.onComputeFallback ? { onFallback: deps.media.onComputeFallback } : {},
    ));
  async function importItem(pack: SfxPack, item: SfxPackItem, signal?: AbortSignal): AsyncResult<AssetId> {
    let bytes: Buffer;
    try {
      bytes = await readFile(pack.pathOf(item));
    } catch {
      return err(SfxPackMissing(undefined, { detail: `the pack has no ${item.file}` }));
    }
    const stored = await deps.sink.put(
      {
        bytes,
        mediaType: item.file.endsWith('.flac')
          ? 'audio/flac'
          : item.file.endsWith('.wav')
            ? 'audio/wav'
            : 'audio/ogg',
        fileName: `sfx-${item.id}.${item.file.split('.').pop() ?? 'opus'}`,
        projectId: null,
        provenance: {
          kind: 'bundled',
          pack: 'sfx-pack',
          itemId: item.id,
          licence: 'CC0-1.0',
          sourceUrl: item.source,
          title: item.title,
        },
      },
      signal ? { signal } : {},
    );
    return stored.ok ? ok(stored.value.assetId) : stored;
  }

  const payloadOf = (timeline: Timeline, hits: SfxHit[]) => ({
    projectId: timeline.projectId,
    timelineId: timeline.id,
    revision: timeline.revision,
    hits,
  });

  /**
   * EAR1-D2/D3: the planner over asked-for bank sounds and a kit's roles (bank-plan.ts). A plan with no hit is
   * refused (EAR1-R2): `sfx.setHits` with none would remove the effects track.
   */
  async function fromBank(request: AddHitsRequest): AsyncResult<HitsOutcome> {
    const hits = await bankHits(
      {
        bank: bankSource,
        sink: deps.sink,
        media: deps.media,
        runner: bankRunner,
        ...(deps.stretcher ? { stretcher: deps.stretcher } : {}),
      },
      { ...request, speech: voiceSpeech(request.timeline) },
    );
    if (!hits.ok) return hits;
    if (hits.value.length === 0) {
      const asked = [...(request.soundIds ?? []), ...(request.kit !== undefined ? ['a kit'] : [])];
      return err(SfxNoFittingCuts(undefined, { detail: `no cut fits ${asked.join(', ')}`.slice(0, 300) }));
    }
    return ok({ payload: payloadOf(request.timeline, hits.value), costUsd: 0 });
  }

  return {
    async addHits(request: AddHitsRequest): AsyncResult<HitsOutcome> {
      const hasSoundIds = Boolean(request.soundIds && request.soundIds.length > 0);
      if (hasSoundIds || request.kit !== undefined) {
        const banked = await fromBank(request);
        if (banked.ok || hasSoundIds || banked.error.code !== 'audio.sfx_bank_missing') return banked;
      }
      const pack = await deps.pack.load();
      if (!pack.ok) return pack;
      const planned = planHits({
        cuts: timelineCuts(request.timeline),
        items: pack.value.items,
        timelineMs: timelineMs(request.timeline),
        speech: voiceSpeech(request.timeline),
        ...(request.density ? { density: request.density } : {}),
        ...(request.style ? { style: request.style } : {}),
      });
      const byId = new Map(pack.value.items.map((item) => [item.id, item]));
      const assets = new Map<string, AssetId>();
      for (const hit of planned) {
        const item = byId.get(hit.item.id);
        if (!item || assets.has(item.id)) continue;
        const assetId = await importItem(pack.value, item, request.signal);
        if (!assetId.ok) return assetId;
        assets.set(item.id, assetId.value);
      }
      return ok({ payload: payloadOf(request.timeline, toHits(planned, assets)), costUsd: 0 });
    },

    /** One generated sound, placed on `cutIndexes` (peak on each cut), added to the hits already there. */
    async generateHit(request: GenerateHitRequest): AsyncResult<HitsOutcome & { assetId: AssetId }> {
      const made = await generateHit(deps, request);
      if (!made.ok) return made;
      return ok({
        payload: payloadOf(request.timeline, made.value.hits),
        costUsd: made.value.costUsd,
        assetId: made.value.assetId,
      });
    },
  };
}
