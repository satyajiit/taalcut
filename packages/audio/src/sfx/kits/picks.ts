// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A kit's takes for `sfx.addHits` 2.0 (EAR1-D3): which role serves each of the planner's cut categories, and each
 * planned take of those roles as a `BankPick` whose anchor is the role's sync point (onset, apex or end, less the
 * role's `offset_ms`). A take the bank has is placed from its file as it is; a take with knobs is rendered here
 * (render-take.ts) into a WAV with the bank's silent pads, so it lands on frames the same way.
 */
import { createHash } from 'node:crypto';
import { ok, type AsyncResult, type SfxCategory } from '@taalcut/core';
import { apexSeconds } from '../bank-apex';
import { bankPick, type BankPick, type TakeBytes } from '../bank-hits';
import { meanOf, SR, type Channels } from './edits';
import { planKit } from './lock';
import { pitchLabel } from './pitch';
import { bankTakeFor, renderTake, type PlannedTake, type TakeRenderDeps } from './render-take';
import { ROLE_ALIGN, type Kit, type KitAlign } from './schema';
import { takeTimes } from '../../listen/dsp/audit-shape';
import { momentaryMaxLufs } from '../../listen/dsp/audit-detectors';

/** The role each cut category takes from a kit unless the caller names another. */
export const CATEGORY_ROLES: Readonly<Record<SfxCategory, string>> = {
  whoosh: 'whoosh.short',
  riser: 'riser',
  impact: 'hit',
  hit: 'land',
};

/** 24-bit PCM WAV of `channels`, between `padMs` of silence. */
export function wavBytes(channels: Channels, padMs: number): Uint8Array {
  const pad = Math.round((padMs * SR) / 1000);
  const frames = (channels[0]?.length ?? 0) + 2 * pad;
  const count = channels.length;
  const data = frames * count * 3;
  const out = Buffer.alloc(44 + data);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + data, 4);
  out.write('WAVEfmt ', 8, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(count, 22);
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * count * 3, 28);
  out.writeUInt16LE(count * 3, 32);
  out.writeUInt16LE(24, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(data, 40);
  for (let f = pad; f < frames - pad; f++)
    for (let c = 0; c < count; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]?.[f - pad] ?? 0));
      out.writeIntLE(Math.round(v * 8_388_607), 44 + (f * count + c) * 3, 3);
    }
  return out;
}

/** The library's item ids are at most this long (core's bundled provenance). */
const TAKE_ID_MAX = 64;

/**
 * An edited take's id: the take it was made from, the role, the pitch, the width and the take number, so two
 * pitches (or widths) of one role never share an id (`planBankHits` keys its picks by it). One over 64 characters
 * keeps its start and ends in a hash of the whole.
 */
export function editedTakeId(baseTakeId: string, planned: PlannedTake): string {
  const pitch = planned.pitch === null ? null : (pitchLabel(planned.pitch) ?? String(planned.pitch));
  const parts = [
    baseTakeId,
    planned.role.replaceAll('.', '-'),
    ...(pitch !== null ? [pitch.replace(/[^A-Za-z0-9-]/g, '-')] : []),
    ...(planned.width !== undefined ? [`w${planned.width}`.replace('.', 'p')] : []),
    String(planned.k),
  ];
  const id = parts.join('_');
  if (id.length <= TAKE_ID_MAX) return id;
  const hash = createHash('sha256').update(id).digest('hex').slice(0, 12);
  return `${id.slice(0, TAKE_ID_MAX - hash.length - 1)}_${hash}`;
}

const alignMs = (times: { onsetMs: number; apexMs: number; endMs: number }, align: KitAlign) =>
  align === 'onset' ? times.onsetMs : align === 'end' ? times.endMs : times.apexMs;

/** A take the bank doesn't have, rendered with its knobs, as a pick with WAV bytes. */
function editedPick(
  deps: TakeRenderDeps,
  planned: PlannedTake,
  category: SfxCategory,
  align: KitAlign,
  offsetMs: number,
  channels: Channels,
  base: BankPick,
): BankPick {
  const pad = deps.bank.catalogue.padMs;
  const mono = meanOf(channels);
  const times = takeTimes(mono);
  const apexMs = apexSeconds(mono) * 1000;
  const anchor =
    alignMs({ onsetMs: times.onsetS * 1000, apexMs, endMs: times.endS * 1000 }, align) - offsetMs;
  const bytes: TakeBytes = { bytes: wavBytes(channels, pad), mediaType: 'audio/wav', extension: 'wav' };
  const takeId = editedTakeId(base.takeId, planned);
  return {
    sound: {
      id: takeId,
      category,
      durationMs: pad + (mono.length * 1000) / SR + pad,
      peakMs: pad + apexMs,
      loudnessLufs: Math.max(-70, Math.min(0, momentaryMaxLufs(channels))),
      anchorMs: pad + anchor,
    },
    item: base.item,
    takeId,
    kitRole: planned.role,
    read: async () => ok(bytes),
  };
}

/**
 * The picks of `kit` for the categories its roles serve (`roles` overrides CATEGORY_ROLES; a role the kit leaves
 * out or sets to null serves nothing, so its cuts get no sound). `kit` has passed `parseKit`.
 */
export async function kitPicks(
  deps: TakeRenderDeps,
  kit: Kit,
  roles: Partial<Record<SfxCategory, string>> = {},
): AsyncResult<BankPick[]> {
  const planned = planKit(kit, deps.bank);
  const picks: BankPick[] = [];
  for (const [category, fallback] of Object.entries(CATEGORY_ROLES) as [SfxCategory, string][]) {
    const role = roles[category] ?? fallback;
    const spec = kit.roles[role];
    if (!spec) continue;
    const align = spec.align ?? ROLE_ALIGN[role] ?? 'onset';
    const offsetMs = spec.offset_ms ?? 0;
    for (const take of planned.filter((p) => p.role === role)) {
      const item = deps.bank.byUpstreamId(take.sound);
      if (!item) continue;
      const own = bankTakeFor(item, take);
      if (own) {
        const anchorMs = alignMs(own, align) - offsetMs;
        picks.push(bankPick(deps.bank, item, own, category, { anchorMs, kitRole: role }));
        continue;
      }
      const made = await renderTake(deps, take);
      if (!made.ok) return made;
      const base = bankPick(deps.bank, item, made.value.take, category, { kitRole: role });
      picks.push(editedPick(deps, take, category, align, offsetMs, made.value.channels, base));
    }
  }
  return ok(picks);
}
