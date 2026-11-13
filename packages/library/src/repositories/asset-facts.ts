// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the asset row learns as it is indexed (P2-L1): media's MediaFacts and
 * the columns filters and sorting read from them, the spoken language, a
 * music file's beat map, and the generation a re-index bumps. Live Photos pair here: the movie half
 * points at its still (`companion_of`, hidden from browse and search) and the
 * still becomes `live_photo`.
 */
import {
  beatMapSchema,
  err,
  mediaFactsSchema,
  ok,
  spokenLanguageSchema,
  ValidationError,
  type AssetId,
  type BeatMap,
  type MediaFacts,
  type Result,
} from '@taalcut/core';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { assets } from '../schema/library';
import { settleCaptureOffsets } from './capture-offsets';
import { found, inTransaction } from './shared';

type Asset = typeof assets.$inferSelect;

export interface AssetFactsMethods {
  /** Stores media's facts (validated) and the columns read from them; pairs a Live Photo's halves. */
  setFacts(id: AssetId, facts: MediaFacts): Result<Asset>;
  /** The spoken language (BCP 47) speech detection found. */
  setLanguage(id: AssetId, language: string | null): Result<Asset>;
  /** A music file's beats (audio.beats), validated; replaces the one it had. */
  setBeatMap(id: AssetId, beatMap: BeatMap): Result<Asset>;
  /** The stored beat map, or null before audio.beats ran (or if it no longer parses). */
  beatMap(asset: Pick<Asset, 'beatMap'>): BeatMap | null;
  /** Bumps each asset's generation (a re-index); returns the new generation per asset. */
  reindex(ids: readonly AssetId[]): Result<Map<AssetId, number>>;
  /** The stored facts, or null before media.normalise ran (or if they no longer parse). */
  facts(asset: Pick<Asset, 'facts'>): MediaFacts | null;
}

const CAPTURE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * The capture time as an instant (epoch ms) and its UTC offset in minutes. A time without an offset is
 * read as UTC and its offset is unknown (null): devices that omit it still sort in order. `Z` is an instant in
 * UTC, not a zone (an MP4's `creation_time` is always written so): its offset is unknown too (LIB1-OEM).
 */
export function parseCaptureTime(text: string): { at: number; offsetMin: number | null } | null {
  const m = CAPTURE_TIME.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  const utc = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, s ? +s : 0, ms);
  if (!Number.isFinite(utc)) return null;
  if (!zone || zone === 'Z') return { at: utc, offsetMin: null };
  const sign = zone.startsWith('-') ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  const offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || '0'));
  return { at: utc - offsetMin * 60_000, offsetMin };
}

/** The zone the facts name: their own offset (LIB1-OEM), else one the capture time carries. */
function captureOffsetOf(facts: MediaFacts, parsed: { offsetMin: number | null }) {
  return { captureOffsetMin: facts.captureOffsetMin ?? parsed.offsetMin };
}

function factColumns(facts: MediaFacts) {
  const capture = facts.captureTime ? parseCaptureTime(facts.captureTime) : null;
  return {
    facts: facts as unknown,
    width: facts.width,
    height: facts.height,
    orientation: facts.orientation,
    hdr: facts.hdr,
    speed: facts.speed,
    frameRateNum: facts.frameRate?.num ?? null,
    frameRateDen: facts.frameRate?.den ?? null,
    hasAudio: facts.hasAudio,
    ...(capture ? { captureTime: capture.at, ...captureOffsetOf(facts, capture) } : {}),
    latitude: facts.location?.latitude ?? null,
    longitude: facts.location?.longitude ?? null,
    deviceMake: facts.device?.make?.normalize('NFC') ?? null,
    deviceModel: facts.device?.model?.normalize('NFC') ?? null,
    livePhotoId: facts.livePhoto?.contentId ?? null,
    ...(facts.duration
      ? {
          durationValue: facts.duration.value,
          durationRateNum: facts.duration.rate.num,
          durationRateDen: facts.duration.rate.den,
        }
      : {}),
  };
}

export function readFacts(asset: Pick<Asset, 'facts'>): MediaFacts | null {
  if (asset.facts == null) return null;
  const parsed = mediaFactsSchema.safeParse(asset.facts);
  return parsed.success ? parsed.data : null;
}

export function createAssetFactsMethods(db: LibraryDatabase): AssetFactsMethods {
  const { orm } = db;
  const get = (id: AssetId) => found(orm.select().from(assets).where(eq(assets.id, id)).get(), 'asset', id);

  /** Links the halves of a Live Photo that share a content id. */
  function pairLivePhoto(id: AssetId, facts: MediaFacts) {
    const live = facts.livePhoto;
    if (!live) return;
    const others = orm
      .select({ id: assets.id, facts: assets.facts })
      .from(assets)
      .where(and(eq(assets.livePhotoId, live.contentId), ne(assets.id, id)))
      .all();
    const partner = others.find((o) => readFacts(o)?.livePhoto?.role !== live.role);
    if (!partner) return;
    const [still, movie] = live.role === 'still' ? [id, partner.id] : [partner.id, id];
    orm.update(assets).set({ kind: 'live_photo' }).where(eq(assets.id, still)).run();
    orm.update(assets).set({ companionOf: still }).where(eq(assets.id, movie)).run();
  }

  return {
    setFacts(id, facts) {
      const parsed = mediaFactsSchema.safeParse(facts);
      if (!parsed.success) return err(ValidationError({ field: 'facts' }, { detail: parsed.error.message }));
      return inTransaction(db, 'asset', () => {
        const updated = orm
          .update(assets)
          .set({ ...factColumns(parsed.data), updatedAt: db.clock() })
          .where(eq(assets.id, id))
          .run();
        if (updated.changes === 0) return get(id);
        pairLivePhoto(id, parsed.data);
        settleCaptureOffsets(db, id);
        return get(id);
      });
    },
    setLanguage(id, language) {
      if (language !== null && !spokenLanguageSchema.safeParse(language).success)
        return err(ValidationError({ field: 'language' }));
      return inTransaction(db, 'asset', () => {
        orm.update(assets).set({ language, updatedAt: db.clock() }).where(eq(assets.id, id)).run();
        return get(id);
      });
    },
    setBeatMap(id, beatMap) {
      const parsed = beatMapSchema.safeParse(beatMap);
      if (!parsed.success) return err(ValidationError({ field: 'beatMap' }, { detail: parsed.error.message }));
      return inTransaction(db, 'asset', () => {
        orm.update(assets).set({ beatMap: parsed.data, updatedAt: db.clock() }).where(eq(assets.id, id)).run();
        return get(id);
      });
    },
    beatMap: readBeatMap,
    reindex(ids) {
      return inTransaction(db, 'asset', () => {
        if (ids.length > 0)
          orm
            .update(assets)
            .set({ generation: sql`${assets.generation} + 1`, updatedAt: db.clock() })
            .where(inArray(assets.id, [...ids]))
            .run();
        const rows =
          ids.length === 0
            ? []
            : orm
                .select({ id: assets.id, generation: assets.generation })
                .from(assets)
                .where(inArray(assets.id, [...ids]))
                .all();
        return ok(new Map(rows.map((r) => [r.id, r.generation])));
      });
    },
    facts: readFacts,
  };
}

export function readBeatMap(asset: Pick<Asset, 'beatMap'>): BeatMap | null {
  if (asset.beatMap == null) return null;
  const parsed = beatMapSchema.safeParse(asset.beatMap);
  return parsed.success ? parsed.data : null;
}
