// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * SFX bank sounds on cuts (EAR1-D2): bank takes as the planner's `HitSound`s, each anchored at its apex (the centre
 * of its loudest 5 ms) or at a kit role's sync point, the takes the plan used added to the library (provenance
 * `bundled`, pack `sfx-bank`, MIT or CC0 as the catalogue says), and the plan as `sfx.setHits` records that name the
 * bank sound and the kit role. Asked-for sounds that aren't in the bank are `audio.kit_invalid`.
 */
import { readFile } from 'node:fs/promises';
import {
  err,
  newId,
  ok,
  RationalTime,
  type AssetId,
  type AsyncResult,
  type GeneratedAssetSink,
  type Result,
  type SfxCategory,
  type SfxHit,
} from '@taalcut/core';
import { KitInvalid, SfxBankMissing } from '../listen/errors';
import { MILLISECONDS } from '../rates';
import type { SfxBankItem, SfxBankTake } from './bank-catalogue';
import type { SfxBank } from './bank-source';
import type { HitSound, PlannedHit } from './hit-plan';

/** A take's bytes as the library stores them. */
export interface TakeBytes {
  readonly bytes: Uint8Array;
  readonly mediaType: 'audio/flac' | 'audio/wav';
  readonly extension: 'flac' | 'wav';
}

/** One bank take ready to plan with: the sound the planner sees, and what the hit and the library record. */
export interface BankPick {
  readonly sound: HitSound;
  readonly item: SfxBankItem;
  /** The library's item id for this take (≤ 64 characters): its file stem, or an edited take's key. */
  readonly takeId: string;
  readonly kitRole?: string;
  read(): AsyncResult<TakeBytes>;
}

/** A take file read from the installed bank. */
export function bankFileReader(bank: SfxBank, take: SfxBankTake): () => AsyncResult<TakeBytes> {
  return async () => {
    try {
      const bytes = await readFile(bank.pathOf(take));
      return ok({ bytes, mediaType: 'audio/flac', extension: 'flac' });
    } catch {
      return err(SfxBankMissing(undefined, { detail: `the sfx-bank component has no ${take.file}` }));
    }
  };
}

/**
 * A take as the planner's sound, serving `category`, its `anchorMs` (ms into the sound; default: its apex) on the
 * cut. The planner sees the file: the bank's silent pads around the sound count in its length and anchor.
 */
export function bankPick(
  bank: SfxBank,
  item: SfxBankItem,
  take: SfxBankTake,
  category: SfxCategory,
  options: { readonly anchorMs?: number; readonly kitRole?: string } = {},
): BankPick {
  const takeId = take.file.replace(/\.flac$/, '');
  const pad = bank.catalogue.padMs;
  return {
    sound: {
      id: takeId,
      category,
      durationMs: pad + take.durationMs + pad,
      peakMs: pad + take.apexMs,
      loudnessLufs: take.loudnessLufs,
      anchorMs: pad + (options.anchorMs ?? take.apexMs),
    },
    item,
    takeId,
    ...(options.kitRole ? { kitRole: options.kitRole } : {}),
    read: bankFileReader(bank, take),
  };
}

/** The takes a sound is placed from without a kit: rendered as it is (no pitch, no width), any audit context. */
export const plainTakes = (item: SfxBankItem): SfxBankTake[] => {
  const plain = item.takes.filter((t) => t.pitch === null && t.width === null && t.auditRole === null);
  return plain.length > 0 ? plain : item.takes.filter((t) => t.pitch === null && t.width === null);
};

/**
 * Every plain take of each asked-for sound (Taalcut or earshot ids), in its own family, apex on the cut. A sound
 * that isn't in the bank, or that the build withheld, is `audio.kit_invalid` naming it.
 */
export function soundPicks(bank: SfxBank, soundIds: readonly string[]): Result<BankPick[]> {
  const picks: BankPick[] = [];
  for (const id of soundIds) {
    const item = bank.byUpstreamId(id);
    const withheld = bank.catalogue.withheld.some((w) => w.id === id || w.upstreamId === id);
    if (!item) {
      const why = withheld ? 'withheld: none of its takes passed the audit' : 'not in the bank';
      return err(KitInvalid(undefined, { detail: `sound ${id}: ${why}` }));
    }
    for (const take of plainTakes(item)) picks.push(bankPick(bank, item, take, item.family));
  }
  return ok(picks);
}

/** Adds each take the plan used to the library once (it dedupes by content). */
export async function importBankTakes(
  sink: GeneratedAssetSink,
  planned: readonly PlannedHit[],
  picks: ReadonlyMap<string, BankPick>,
  signal?: AbortSignal,
): AsyncResult<Map<string, AssetId>> {
  const assets = new Map<string, AssetId>();
  for (const hit of planned) {
    const pick = picks.get(hit.item.id);
    if (!pick || assets.has(pick.takeId)) continue;
    const read = await pick.read();
    if (!read.ok) return read;
    const stored = await sink.put(
      {
        bytes: Buffer.from(read.value.bytes),
        mediaType: read.value.mediaType,
        fileName: `sfx-bank-${pick.takeId}.${read.value.extension}`,
        projectId: null,
        provenance: {
          kind: 'bundled',
          pack: 'sfx-bank',
          itemId: pick.takeId.slice(0, 64),
          licence: pick.item.licence,
          sourceUrl: pick.item.sourceUrl,
          title: pick.item.title,
        },
      },
      signal ? { signal } : {},
    );
    if (!stored.ok) return stored;
    assets.set(pick.takeId, stored.value.assetId);
  }
  return ok(assets);
}

const ms = (value: number) => RationalTime.of(Math.round(value), MILLISECONDS);

/** The plan as `sfx.setHits` records: whole milliseconds, each naming its bank sound and, from a kit, its role. */
export function bankHitRecords(
  planned: readonly PlannedHit[],
  picks: ReadonlyMap<string, BankPick>,
  assets: ReadonlyMap<string, AssetId>,
): SfxHit[] {
  return planned.flatMap((hit) => {
    const pick = picks.get(hit.item.id);
    const assetId = pick && assets.get(pick.takeId);
    if (!pick || !assetId) return [];
    return [
      {
        id: newId<'TimelineItem'>(),
        at: ms(hit.startMs),
        assetId,
        sourceStart: ms(hit.sourceStartMs),
        duration: ms(hit.durationMs),
        gainDb: hit.gainDb,
        category: hit.category,
        ...(pick.kitRole ? { kitRole: pick.kitRole } : {}),
        soundId: pick.item.id,
        cut: ms(hit.cutMs),
      },
    ];
  });
}
