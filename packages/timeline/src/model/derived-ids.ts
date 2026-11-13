// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Ids derived from a seed instead of drawn: the same seed names the same things on every run. The energy curve
 * (P3-V12) uses them so its plan, its command and the command's redo agree on the new slots and items. ULIDs: a
 * time prefix, then 80 bits of sha256(seed, n).
 */
import { createHash } from 'node:crypto';
import type { CommandId, EnergyCurve, Id, SlotId, Template, TimelineItemId } from '@taalcut/core';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_MAX = 2 ** 48 - 1;

function encodeTime(ms: number): string {
  let rest = Math.min(Math.max(0, Math.floor(ms)), TIME_MAX);
  let out = '';
  for (let index = 0; index < 10; index++) {
    out = (CROCKFORD[rest % 32] as string) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function encodeBits(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 16) {
      out += CROCKFORD[(buffer >> (bits - 5)) & 31] as string;
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

/** A ULID's time part, in ms. */
const timeOf = (id: string): number => [...id.slice(0, 10)].reduce((sum, char) => sum * 32 + CROCKFORD.indexOf(char), 0);

/** A ULID factory: `time` (ms) as the time part, sha256(`seed`:n) as the rest. */
export function derivedIds<Entity extends string>(seed: string, time: number): () => Id<Entity> {
  const prefix = encodeTime(time);
  let next = 0;
  return () => {
    const digest = createHash('sha256').update(`${seed}:${next++}`).digest();
    return `${prefix}${encodeBits(digest.subarray(0, 10))}` as Id<Entity>;
  };
}

/** The curve in a fixed field order, whatever order its object keys came in. */
const curveText = (curve: EnergyCurve) =>
  curve.sections
    .map((section) => [section.fromSlotId, section.toSlotId, section.energy, section.beatsPerClip, section.align].join(','))
    .join(';');

/** The new slots' ids for a template version and a curve. */
export function energySlotIds(template: Template, curve: EnergyCurve): { slot(): SlotId } {
  return { slot: derivedIds<'TemplateSlot'>(`${template.id}:${template.version}:${curveText(curve)}`, template.createdAt) };
}

/** Item ids for one command: its redo (the same command id) makes the same ones. */
export function commandItemIds(commandId: CommandId): () => TimelineItemId {
  return derivedIds<'TimelineItem'>(`items:${commandId}`, timeOf(commandId));
}
