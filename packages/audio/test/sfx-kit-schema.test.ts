// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-D3: kit schema 1. Pitches parse and label as earshot's do; a kit that a render would refuse is
 * `audio.kit_invalid` naming every problem; the four vendored presets parse against the installed bank, and plan
 * the same take files and seeds as upstream's kit.lock.json.
 */
import { describe, expect, it } from 'vitest';
import { kit as fixtureKit } from '../../../tools/earshot-parity/fixtures.mjs';
import { sfxBankOf } from '../src/sfx/bank-source';
import { planKit } from '../src/sfx/kits/lock';
import { pitchHz, pitchLabel } from '../src/sfx/kits/pitch';
import { KIT_PRESETS, kitPreset } from '../src/sfx/kits/presets';
import { parseKit, takeNames, type Kit } from '../src/sfx/kits/schema';
import { bankCatalogue, bankItem, bankTake, HAS_BANK, installedBank } from './sfx-bank-helpers';

const pluck = bankItem({
  id: 'pluck/kalimba',
  upstreamId: 'pluck/kalimba',
  category: 'pluck',
  member: 'kalimba',
  seed: 8001,
  title: 'Pluck, kalimba',
  family: 'hit',
  kinds: ['bell', 'text', 'hit'],
  source: 'pluck',
  knobs: { dur: 'trim', apex: false, pitch: { nativeHz: 523.25, note: 'C5', rangeHz: [130, 2100] } },
  takes: [bankTake({ file: 'pluck.kalimba_s8001.flac', seed: 8001, plannedSeed: 8001, apexMs: 13.5 })],
});
const bank = sfxBankOf(
  bankCatalogue([bankItem(), pluck], {
    withheld: [{ id: 'pro_zip/up_hi', upstreamId: 'pro_zip/up_hi', warnings: ['rising_glide'] }],
  }),
  '/nowhere',
);
const kit = (roles: Kit['roles'], extra: Partial<Kit> = {}): unknown => ({
  kit: 1,
  name: 't',
  sr: 48000,
  roles,
  ...extra,
});
const problem = (json: unknown) => {
  const parsed = parseKit(json, bank);
  return parsed.ok ? 'ok' : `${parsed.error.code} ${parsed.error.detail ?? ''}`;
};

describe('kit pitches (earshot knobs.hz / label)', () => {
  it('reads note names, sharps written s, flats, Hz', () => {
    expect(pitchHz('A4')).toBe(440);
    expect(pitchHz('440hz')).toBe(440);
    expect(pitchHz(523.25)).toBe(523.25);
    expect(pitchHz('C#5')).toBeCloseTo(554.365, 3);
    expect(pitchHz('Cs5')).toBe(pitchHz('C#5'));
    expect(pitchHz('Db5')).toBe(pitchHz('C#5'));
    expect(pitchHz('H2')).toBeNull();
    expect(pitchHz(30_000)).toBeNull();
  });

  it('labels each pitch once, as take file names do', () => {
    expect(['C#5', 'Db5', 'Cs5', 554.37].map((p) => pitchLabel(p))).toEqual(['Cs5', 'Cs5', 'Cs5', 'Cs5']);
    expect(pitchLabel(523.25)).toBe('C5');
    expect(pitchLabel(445)).toBe('445hz');
    expect(pitchLabel('Bb-1')).toBe('Bb-1');
  });
});

describe('kit validation (EAR1-D3)', () => {
  it('accepts a valid kit, a null role and the mix keys', () => {
    expect(
      problem(
        kit(
          {
            'whoosh.short': {
              sound: 'whoosh_fast/crisp',
              takes: 3,
              edits: { dur: 0.6, apex: 0.2 },
              align: 'peak',
            },
            bell: { sound: 'pluck/kalimba', pitches: ['C5', 'E5'], width: 0.6, bed_db: 7.5, offset_ms: -20 },
            riser: null,
          },
          { off: { riser: 'a reveal resolves on one element' }, mix: { stop_down: { before: ['bell'] } } },
        ),
      ),
    ).toBe('ok');
  });

  it('refuses, as audio.kit_invalid, what a render would refuse', () => {
    const refused: [unknown, RegExp][] = [
      [{ kit: 2, roles: { hit: { sound: 'pluck/kalimba' } } }, /kit/],
      [kit({ hit: { sound: 'pluck/kalimba', volume: 3 } as never }), /unrecognized|Unrecognized/],
      [kit({ Hit: { sound: 'pluck/kalimba' } }), /roles/],
      [kit({ hit: { sound: 'pluck/nope' } }), /unknown sound pluck\/nope/],
      [kit({ hit: { sound: 'pro_zip/up_hi' } }), /withheld sound pro_zip\/up_hi/],
      [kit({ hit: { sound: 'pluck/kalimba', takes: 33 } }), /takes must be an integer 1-32/],
      [kit({ hit: { sound: 'whoosh_fast/crisp', edits: { pitch: 'C5' } } }), /takes no pitch/],
      [kit({ hit: { sound: 'pluck/kalimba', edits: { pitch: 'C8' } } }), /outside 130-2100 Hz/],
      [kit({ hit: { sound: 'pluck/kalimba', edits: { apex: 0.2 } } }), /apex applies to the whoosh family/],
      [kit({ hit: { sound: 'whoosh_fast/crisp', edits: { dur: 0.3, apex: 0.29 } } }), /must lie inside/],
      [kit({ hit: { sound: 'pluck/kalimba', edits: { peak_db: 1 } } }), /over 0 dBFS/],
      [kit({ hit: { sound: 'pluck/kalimba', edits: { weight: 5 } } }), /weight must be in/],
      [kit({ hit: { sound: 'pluck/kalimba', edits: { dur: 90 } } }), /dur must be 0.01-60 s/],
      [kit({ hit: { sound: 'pluck/kalimba', max_s: 0.001 } }), /max_s/],
      [kit({ bell: { sound: 'pluck/kalimba', pitches: ['C5'], edits: { pitch: 'C5' } } }), /not both/],
      [kit({ bell: { sound: 'pluck/kalimba', pitches: ['C#5', 'Db5'] } }), /are one pitch/],
      [
        kit({ hit: { sound: 'pluck/kalimba' } }, { mix: { stop_down: { before: ['drop'] } } }),
        /drop is no role/,
      ],
      [kit({ hit: { sound: 'pluck/kalimba', bed_db: 40 } }), /bed_db|too big|<=/],
    ];
    for (const [json, why] of refused) {
      const said = problem(json);
      expect(said, JSON.stringify(json)).toMatch(/^audio\.kit_invalid /);
      expect(said, JSON.stringify(json)).toMatch(why);
    }
    // Every problem is named.
    expect(problem(kit({ a: { sound: 'pluck/nope' }, b: { sound: 'pluck/kalimba', takes: 0 } }))).toMatch(
      /unknown sound pluck\/nope.*takes must be/,
    );
  });

  it('names take files as earshot does, case-insensitively unique', () => {
    const two: Kit = {
      kit: 1,
      roles: {
        bell: { sound: 'pluck/kalimba', pitches: ['C5', 'Db5'] },
        'tick.crisp': { sound: 'x', takes: 2 },
        hit: { sound: 'x' },
      },
    };
    expect(takeNames(two).map(([, file]) => file)).toEqual([
      'bell_C5.wav',
      'bell_Cs5.wav',
      'tick-crisp_1.wav',
      'tick-crisp_2.wav',
      'hit_1.wav',
    ]);
  });
});

describe.skipIf(!HAS_BANK)('the four presets against the installed bank (EAR1-D3)', () => {
  it('parse, and plan upstream’s take files and seeds', async () => {
    const installed = await installedBank();
    for (const name of KIT_PRESETS) {
      const parsed = parseKit(kitPreset(name), installed);
      if (!parsed.ok) throw new Error(`${name}: ${parsed.error.detail}`);
      const { lock } = fixtureKit(name) as unknown as {
        lock: { roles: Record<string, { takes: Record<string, unknown>[] } | null> };
      };
      const upstream = Object.entries(lock.roles).flatMap(([role, r]) =>
        (r?.takes ?? []).map((t) => [role, t.file, t.planned_seed ?? t.seed]),
      );
      const ours = planKit(parsed.value, installed).map((t) => [t.role, t.file, t.seed]);
      expect(ours, name).toEqual(upstream);
    }
  });
});
