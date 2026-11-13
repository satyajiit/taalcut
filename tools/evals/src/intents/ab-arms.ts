// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two arms of the LRN1-CTX intent A/B: the same reference reels broken down and finalised by the Analyst
 * without slot context (a build before LRN1-CTX) and with it. Each arm is a folder of the templates the runs
 * saved, `<reelId>.json` (Template v1, as `templates.get` or an export writes it). Slots are paired across the
 * arms by time, so a disputed cut judged differently in the two runs costs only the slots around it.
 */
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { RationalTime, type SlotIntent, type Template } from '@taalcut/core';
import { migrateTemplate } from '@taalcut/templates';
import { jsonFiles, readJson } from '../files';

export const ARMS = ['with', 'without'] as const;
export type Arm = (typeof ARMS)[number];

/** A template file as a Template v1, migrated like the store migrates one on read. */
export function readTemplateFile(path: string): Template {
  const json = readJson(path);
  const version =
    json !== null &&
    typeof json === 'object' &&
    'schemaVersion' in json &&
    typeof json.schemaVersion === 'number'
      ? json.schemaVersion
      : 1;
  const migrated = migrateTemplate(json, version);
  if (!migrated.ok)
    throw new Error(`${path} is not a template: ${migrated.error.detail ?? migrated.error.code}`);
  return migrated.value;
}

/** An arm's templates by reel id (the file name without `.json`). */
export function loadArm(dir: string): Map<string, Template> {
  const files = jsonFiles(dir);
  if (files.length === 0) throw new Error(`No templates (*.json) in ${dir}`);
  return new Map(files.map((file) => [basename(file.name, '.json'), readTemplateFile(file.path)]));
}

/**
 * True when any template of either arm wasn't broken down from a reference (a fixture, a hand-made template):
 * numbers made from such arms are synthetic whatever the caller says.
 */
export function armsAreSynthetic(arms: Readonly<Record<Arm, ReadonlyMap<string, Template>>>): boolean {
  return ARMS.some((arm) => [...arms[arm].values()].some((template) => template.origin.kind !== 'reference'));
}

export interface SlotSpan {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

/** A template's slots as frame spans on its canvas grid. */
export function spansOf(template: Template): SlotSpan[] {
  const frame = (time: RationalTime) => RationalTime.toFrames(time, template.canvas.rate);
  return template.slots.map((slot, index) => ({
    index,
    start: frame(slot.start),
    end: frame(RationalTime.add(slot.start, slot.duration)),
  }));
}

/**
 * Slots of `a` and `b` that cover the same shot: each `a` slot with the `b` slot it overlaps most, when that
 * overlap is at least half of the shorter of the two (the shot-matching rule of the search and casting evals),
 * each `b` slot used once. Returns index pairs in `a`'s order and the slots of either side left over.
 */
export function pairSlots(
  a: readonly SlotSpan[],
  b: readonly SlotSpan[],
): { pairs: [number, number][]; unpairedA: number[]; unpairedB: number[] } {
  const used = new Set<number>();
  const pairs: [number, number][] = [];
  const unpairedA: number[] = [];
  for (const slot of a) {
    let best: { index: number; overlap: number } | undefined;
    for (const other of b) {
      if (used.has(other.index)) continue;
      const overlap = Math.min(slot.end, other.end) - Math.max(slot.start, other.start);
      const shorter = Math.min(slot.end - slot.start, other.end - other.start);
      if (overlap * 2 >= shorter && overlap > 0 && overlap > (best?.overlap ?? 0))
        best = { index: other.index, overlap };
    }
    if (best) {
      used.add(best.index);
      pairs.push([slot.index, best.index]);
    } else unpairedA.push(slot.index);
  }
  return { pairs, unpairedA, unpairedB: b.filter((slot) => !used.has(slot.index)).map((slot) => slot.index) };
}

/** What the rater sees of a slot beside the two intents: the same for both arms (it is the reference's). */
export interface SlotView {
  readonly start: number;
  readonly end: number;
  /** The contact sheet tile of the slot, when the template kept a sheet. */
  readonly tile: number | null;
  readonly onScreen: string;
  readonly speech: string;
}

/** The reference's on-screen text and speech over `span` of `template`, for the rater (plain, joined by " / "). */
function slotView(template: Template, span: SlotSpan): SlotView {
  const frame = (time: RationalTime) => RationalTime.toFrames(time, template.canvas.rate);
  const over = (item: { readonly start: RationalTime; readonly duration: RationalTime }) =>
    frame(item.start) < span.end && frame(RationalTime.add(item.start, item.duration)) > span.start;
  const joined = (texts: readonly string[]) =>
    [...new Set(texts.map((text) => text.trim()).filter(Boolean))].join(' / ');
  return {
    start: span.start,
    end: span.end,
    tile: template.slots[span.index]?.frame ?? null,
    onScreen: joined(template.text.filter(over).map((item) => item.text)),
    speech: joined((template.audio.speech?.segments ?? []).filter(over).map((segment) => segment.text)),
  };
}

/** Which arm a row shows first: from the seed, the reel and the slot, so a sheet is the same on every run. */
export function firstArm(seed: string, reel: string, slot: number): Arm {
  const byte = createHash('sha256').update(`${seed}:${reel}:${slot}`).digest()[0] ?? 0;
  return byte % 2 === 0 ? 'with' : 'without';
}

export interface PairedSlot extends SlotView {
  readonly reel: string;
  /** The slot's index in the with-context arm's template. */
  readonly slot: number;
  readonly intents: Readonly<Record<Arm, SlotIntent>>;
}

export interface ArmPairing {
  readonly rows: PairedSlot[];
  /** Per reel, the slots one arm has and the other doesn't cover. */
  readonly unpaired: { reel: string; with: number[]; without: number[] }[];
}

/** One reel's paired rows, and the slots of either arm left over. */
function pairReel(
  reel: string,
  a: Template,
  b: Template,
): { rows: PairedSlot[]; left: ArmPairing['unpaired'][number] } {
  if (
    a.origin.kind === 'reference' &&
    b.origin.kind === 'reference' &&
    a.origin.fingerprint !== b.origin.fingerprint
  )
    throw new Error(`Reel ${reel}: the arms were made from different references`);
  const spans = spansOf(a);
  const paired = pairSlots(spans, spansOf(b));
  const rows = paired.pairs.flatMap(([index, other]) => {
    const span = spans[index];
    const own = a.slots[index]?.intent;
    const counterpart = b.slots[other]?.intent;
    if (!span || !own || !counterpart) return [];
    return [{ reel, slot: index, ...slotView(a, span), intents: { with: own, without: counterpart } }];
  });
  return { rows, left: { reel, with: paired.unpairedA, without: paired.unpairedB } };
}

/** Every reel both arms have, slot by slot. A reel only one arm has is an error: the arms must be the same reels. */
export function pairArms(
  withArm: ReadonlyMap<string, Template>,
  withoutArm: ReadonlyMap<string, Template>,
): ArmPairing {
  const rows: PairedSlot[] = [];
  const unpaired: ArmPairing['unpaired'] = [];
  for (const reel of [...new Set([...withArm.keys(), ...withoutArm.keys()])].sort()) {
    const a = withArm.get(reel);
    const b = withoutArm.get(reel);
    if (!a || !b)
      throw new Error(
        `Reel ${reel} is in the ${a ? 'with' : 'without'} arm only: run both arms on every reel`,
      );
    const paired = pairReel(reel, a, b);
    rows.push(...paired.rows);
    if (paired.left.with.length + paired.left.without.length > 0) unpaired.push(paired.left);
  }
  if (rows.length === 0) throw new Error('The arms share no slot');
  return { rows, unpaired };
}
