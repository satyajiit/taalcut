// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EAR1-K0's contract for the SFX bank (D22): its provenance and licence, and the kit role and sound of a hit. */
import { describe, expect, it } from 'vitest';
import {
  assetProvenanceSchema,
  BUNDLED_LICENCES,
  BUNDLED_PACKS,
  MIX_COMMANDS,
  mixCommandPayloads,
  newId,
  SFX_CATEGORIES,
  sfxBankSoundIdSchema,
  sfxHitSchema,
  sfxKitRoleSchema,
} from '@taalcut/core';
import { at, json } from './helpers/documents';

const bankItem = {
  kind: 'bundled',
  pack: 'sfx-bank',
  itemId: 'whoosh_fast/crisp',
  licence: 'MIT',
  sourceUrl: 'https://github.com/Leonxlnx/earshot',
  title: 'Fast whoosh, crisp',
} as const;

describe('EAR1-K0: bundled provenance (D22)', () => {
  it('adds the SFX bank, and lets a code-made render be MIT', () => {
    expect(BUNDLED_PACKS).toEqual(['music-pack', 'sfx-pack', 'sfx-bank']);
    expect(BUNDLED_LICENCES).toEqual(['CC0-1.0', 'MIT']);
    expect(assetProvenanceSchema.parse(json(bankItem))).toEqual(bankItem);
    // A fitted bank sound keeps its CC0 dedication; the older packs parse unchanged.
    expect(assetProvenanceSchema.parse({ ...bankItem, licence: 'CC0-1.0' })).toEqual({
      ...bankItem,
      licence: 'CC0-1.0',
    });
    expect(assetProvenanceSchema.parse({ ...bankItem, pack: 'sfx-pack', licence: 'CC0-1.0' }).kind).toBe(
      'bundled',
    );
  });

  it('still refuses a licence that asks for credit, and an unknown pack', () => {
    expect(assetProvenanceSchema.safeParse({ ...bankItem, licence: 'CC-BY-4.0' }).success).toBe(false);
    expect(assetProvenanceSchema.safeParse({ ...bankItem, pack: 'sfx-kits' }).success).toBe(false);
  });
});

describe('EAR1-K0: a hit’s kit role and bank sound', () => {
  const hit = {
    id: newId<'TimelineItem'>(),
    at: at(30),
    assetId: newId<'Asset'>(),
    sourceStart: at(0),
    duration: at(10),
    gainDb: -12,
    category: 'whoosh',
  } as const;

  it('keeps the four categories and parses a version 1 hit unchanged', () => {
    expect(SFX_CATEGORIES).toEqual(['whoosh', 'riser', 'impact', 'hit']);
    expect(sfxHitSchema.parse(json(hit))).toEqual(hit);
  });

  it('carries the kit role and the bank sound, optionally', () => {
    const placed = { ...hit, kitRole: 'whoosh.short', soundId: 'whoosh_fast/crisp' };
    expect(sfxHitSchema.parse(json(placed))).toEqual(placed);
    const hits = mixCommandPayloads[MIX_COMMANDS.setHits];
    const payload = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>(), hits: [placed, hit] };
    expect(hits.parse(json(payload))).toEqual(payload);
  });

  it('names roles and sounds as the bank does', () => {
    for (const role of ['hit', 'whoosh.short', 'tick.crisp', 'land_light'])
      expect(sfxKitRoleSchema.safeParse(role).success, role).toBe(true);
    for (const role of ['', 'Hit', 'whoosh.', '.hit', 'whoosh short', 'a'.repeat(49)])
      expect(sfxKitRoleSchema.safeParse(role).success, role).toBe(false);
    for (const id of ['cut_hit/sub', 'notify/m0', 'whoosh_fast'])
      expect(sfxBankSoundIdSchema.safeParse(id).success, id).toBe(true);
    for (const id of ['', 'Cut_hit/sub', 'cut_hit/', 'a/b/c', '../etc', 'cut hit/sub'])
      expect(sfxBankSoundIdSchema.safeParse(id).success, id).toBe(false);
    expect(sfxHitSchema.safeParse({ ...hit, soundId: '../secret' }).success).toBe(false);
  });

  it('EAR1-K3: carries the cut it was placed for, optionally', () => {
    const placed = { ...hit, cut: at(45) };
    expect(sfxHitSchema.parse(json(placed))).toEqual(placed);
    expect(sfxHitSchema.parse(json(hit))).not.toHaveProperty('cut');
    expect(sfxHitSchema.safeParse({ ...hit, cut: 45 }).success).toBe(false);
  });
});
