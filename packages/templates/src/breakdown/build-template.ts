// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Draft → slots → Template (SPEC "Output"). `resolveCuts` applies the
 * Analyst's verdicts on disputed cuts (a decided cut is `vision`), the rule
 * where there is no verdict (`rule`), and the flash rule (a shot under two
 * frames merges into its neighbour unless both methods found both its cuts).
 * `buildTemplate` makes version 1: intents the Analyst wrote are `analyst`, a
 * slot it skipped stays `pending` (the card says so).
 */
import {
  CAMERA_MOTIONS,
  err,
  INTENT_FACES,
  INTENT_NEED_CHARS,
  INTENT_NEEDS_MAX,
  ok,
  RationalTime,
  SHOT_TYPES,
  templateSchema,
  ValidationError,
  type Result,
  type SlotIntent,
  type Template,
  type TemplateSlot,
} from '@taalcut/core';
import { z } from 'zod';
import { anchorAt, beatFrames, computePacing } from '../edits/timing';
import type { TemplateIds } from '../formats/plan-format';
import { parseReferenceLink } from '../intake/reference-link';
import type { CutMethod, SlotRole } from '../types';
import { BREAKDOWN_CONFIG, type BreakdownConfig } from './config';
import { measuredMotion, slotMeasure } from './camera';
import { slotDoubts } from './doubts';
import type { BreakdownDraft, DraftCut } from './draft';
import { withSlotListening } from './listening-slots';
import { withOverlayRelations } from './overlay-relation';

export interface CutVerdict {
  /** The disputed cut's frame (±2 frames matches). */
  readonly at: number;
  readonly cut: boolean;
}

export interface ResolvedCut {
  readonly frame: number;
  readonly method: CutMethod;
  readonly confidence: number;
  readonly transition: DraftCut['transition'];
}

export interface ResolvedSlot {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  /** 512 px frames of the matching provisional slot (experiment-relative), when there is one. */
  readonly frames: readonly string[];
}

export interface Resolution {
  readonly cuts: readonly ResolvedCut[];
  readonly slots: readonly ResolvedSlot[];
  /** Cuts only one method found (the rule kept them): the Analyst reports these. */
  readonly unconfirmed: readonly number[];
}

const CONFIDENCE: Record<CutMethod, number> = {
  both: 0.95,
  vision: 0.85,
  scdet: 0.7,
  rule: 0.6,
  embedding: 0.6,
  format: 1,
  user: 1,
};

const VERDICT_TOLERANCE = 2;

export function resolveCuts(
  draft: BreakdownDraft,
  verdicts: readonly CutVerdict[],
  config: Pick<BreakdownConfig, 'flash'> = BREAKDOWN_CONFIG,
): Resolution {
  const total = draft.duration.value;
  const kept: ResolvedCut[] = draft.cuts.map((cut) => ({
    frame: cut.frame,
    method: cut.method,
    confidence: CONFIDENCE[cut.method],
    transition: cut.transition,
  }));
  for (const dispute of draft.disputes) {
    const verdict = verdicts.find((item) => Math.abs(item.at - dispute.frame) <= VERDICT_TOLERANCE);
    if (verdict ? verdict.cut : dispute.ruleKeeps) {
      const method: CutMethod = verdict ? 'vision' : 'rule';
      kept.push({
        frame: dispute.frame,
        method,
        confidence: CONFIDENCE[method],
        transition: dispute.transition,
      });
    }
  }
  const sorted = kept
    .filter((cut) => cut.frame > 0 && cut.frame < total)
    .sort((a, b) => a.frame - b.frame || b.confidence - a.confidence);
  const cuts: ResolvedCut[] = [];
  for (const cut of sorted) {
    const previous = cuts[cuts.length - 1];
    const gap = cut.frame - (previous?.frame ?? 0);
    if (gap >= config.flash.minFrames) {
      cuts.push(cut);
      continue;
    }
    // A shot shorter than minFrames: keep it only when both methods found both of its cuts.
    if (previous && gap > 0 && previous.method === 'both' && cut.method === 'both') {
      cuts.push(cut);
      continue;
    }
    if (previous && cut.confidence > previous.confidence) cuts[cuts.length - 1] = cut;
  }
  const bounds = [0, ...cuts.map((cut) => cut.frame), total];
  const slotFramesByStart = new Map(draft.slotFrames.map((slot) => [slot.start, slot.frames]));
  const slots = bounds.slice(0, -1).map((start, index) => ({
    index,
    start,
    end: bounds[index + 1]!,
    frames: slotFramesByStart.get(start) ?? [],
  }));
  const unconfirmed = cuts
    .filter((cut) => cut.method === 'rule' || cut.method === 'scdet')
    .map((cut) => cut.frame);
  return { cuts, slots, unconfirmed };
}

/** What the Analyst writes for a slot: the intent fields (source is set here) and, optionally, its role. */
export const analystIntentSchema = z.object({
  text: z.string().trim().min(1).max(500),
  shotType: z.enum(SHOT_TYPES).nullable(),
  /** FRM1-MOT: measured (camera.ts), so the Analyst gives none; one from before FRM1 is kept without a measure. */
  motion: z.enum(CAMERA_MOTIONS).nullable().default(null),
  subject: z.string().max(120).nullable(),
  people: z.int().min(0).max(50).nullable(),
  place: z.string().max(120).nullable(),
  energy: z.number().min(0).max(1),
  /** FIX-CAST: what the reel literally shows; the fields above say what the shot does, for anyone's footage. */
  reel: z.string().trim().min(1).max(500).optional(),
  /** FIX-HOOK: what the footage must show for the slot to work, and whether the reel shows the face (core's intent). */
  needs: z.array(z.string().trim().min(1).max(INTENT_NEED_CHARS)).max(INTENT_NEEDS_MAX).optional(),
  face: z.enum(INTENT_FACES).nullable().optional(),
});
export type AnalystIntent = z.input<typeof analystIntentSchema>;

export interface SlotIntentInput {
  readonly slotIndex: number;
  readonly intent: AnalystIntent;
  readonly role?: SlotRole;
  /** AGT1: templates.setIntents took a name out of the intent with no general word for it: the review asks. */
  readonly generalised?: boolean;
}

const PENDING: SlotIntent = {
  text: '',
  shotType: null,
  motion: null,
  subject: null,
  people: null,
  place: null,
  energy: 0.5,
  source: 'pending',
};

function defaultRole(index: number, count: number): SlotRole {
  if (index === 0) return 'hook';
  return index === count - 1 && count >= 3 ? 'outro' : 'body';
}

/** The reel's link as the template keeps it: without the sharer's tokens (a draft from before REF1 may have them). */
function linkOrNull(draft: BreakdownDraft): string | null {
  const url = draft.reference.url;
  if (draft.reference.input !== 'link' || url === null || !/^https:\/\//.test(url)) return null;
  const link = parseReferenceLink(url);
  return link.ok ? link.value.url : url;
}

export function buildTemplate(
  draft: BreakdownDraft,
  verdicts: readonly CutVerdict[],
  intents: readonly SlotIntentInput[],
  ids: TemplateIds,
  options: {
    readonly createdAt: number;
    readonly contactSheetAsset?: string | null;
    readonly config?: BreakdownConfig;
  },
): Result<Template> {
  const config = options.config ?? BREAKDOWN_CONFIG;
  const { cuts, slots: bounds } = resolveCuts(draft, verdicts, config);
  const rate = draft.canvas.rate;
  const at = (frame: number) => RationalTime.of(frame, rate);
  const beats = beatFrames(draft.beatMap, rate);
  const sheet = options.contactSheetAsset && draft.contactSheet ? draft.contactSheet : null;
  const tileOf = (start: number, end: number) => {
    const index = sheet?.frames.findIndex((frame) => frame >= start && frame < end) ?? -1;
    return index >= 0 ? index : null;
  };
  const intentsBySlot = new Map(intents.map((item) => [item.slotIndex, item]));
  const rampsByRange = new Map(draft.ramps.map((item) => [`${item.start}:${item.end}`, item]));

  const slots: TemplateSlot[] = bounds.map((bound) => {
    const cut = bound.index === 0 ? null : cuts[bound.index - 1]!;
    const previous = bounds[bound.index - 1];
    const given = intentsBySlot.get(bound.index);
    const ramp = rampsByRange.get(`${bound.start}:${bound.end}`);
    const transition = cut?.transition;
    return {
      id: ids.slot(),
      name: null,
      role: given?.role ?? defaultRole(bound.index, bounds.length),
      start: at(bound.start),
      duration: at(bound.end - bound.start),
      intent: given ? { ...given.intent, motion: given.intent.motion ?? null, source: 'analyst' } : PENDING,
      beatAnchor: draft.beatMap ? anchorAt(beats, bound.start, rate) : null,
      transitionIn:
        transition && previous
          ? {
              kind: transition.kind,
              before: at(Math.min(transition.before, previous.end - previous.start)),
              after: at(Math.min(transition.after, bound.end - bound.start)),
              direction: null,
              confidence: transition.confidence,
            }
          : null,
      speedRamp: ramp
        ? { points: ramp.points.map((point) => ({ at: at(point.at), speed: point.speed })), curve: 'linear' }
        : null,
      // The first slot starts with the reel, not at a cut: a rule, certain.
      cut: cut ? { method: cut.method, confidence: cut.confidence } : { method: 'rule', confidence: 1 },
      approved: false,
      frame: tileOf(bound.start, bound.end),
    };
  });

  // BRK1: what the review should ask about each slot (doubts.ts). FRM1-MOT: the camera's move is measured; a sure
  // measure is the slot's motion, an unsure one leaves it unknown (no constraint for casting) and asks.
  const written = slots.map((slot) => slot.intent);
  slots.forEach((slot, index) => {
    const measure = slotMeasure(draft.camera, bounds[index]!);
    const measured = measuredMotion(measure);
    const doubts = slotDoubts(
      {
        first: index === 0,
        cut: slot.cut,
        transition: slot.transitionIn,
        seconds: RationalTime.toSeconds(slot.duration),
        intent: slot.intent,
        ...(measure && measured.unsure ? { motionUnsure: measure.confidence } : {}),
        ...(intentsBySlot.get(index)?.generalised ? { generalised: true } : {}),
      },
      written,
      config,
    );
    const intent = measure ? { ...slot.intent, motion: measured.motion } : slot.intent;
    if (doubts.length > 0 || measure)
      slots[index] = {
        ...slot,
        intent,
        ...(measure ? { motionMeasure: measure } : {}),
        ...(doubts.length > 0 ? { doubts } : {}),
      };
  });

  const slotAt = (frame: number) => slots.findLast((slot) => slot.start.value <= frame) ?? slots[0]!;
  const text = draft.text
    .filter((item) => item.start.value < draft.duration.value)
    .map((item) => {
      const end = Math.min(item.start.value + item.duration.value, draft.duration.value);
      return {
        ...item,
        duration: at(Math.max(1, end - item.start.value)),
        slotId: slotAt(item.start.value).id,
      };
    });

  const { reference } = draft;
  const candidate: Template = {
    schemaVersion: 1,
    id: ids.template(),
    version: 1,
    parentVersion: null,
    createdAt: options.createdAt,
    origin: {
      kind: 'reference',
      input: reference.input,
      platform: reference.platform,
      url: linkOrNull(draft),
      fingerprint: draft.fingerprint,
      source: reference.source,
      crop: reference.crop,
      pipelineVersion: draft.pipelineVersion,
      configVersion: draft.configVersion,
      analysedAt: draft.analysedAt,
    },
    canvas: draft.canvas,
    duration: draft.duration,
    slots,
    beatMap: draft.beatMap,
    text,
    // EAR1-C1: what the breakdown heard, each cut's sync and effect under its slot.
    audio: withSlotListening(
      draft.audio,
      bounds.map((bound) => bound.start),
      rate,
    ),
    pacing: computePacing(slots, draft.beatMap, rate),
    styleId: null,
    contactSheet: sheet
      ? {
          asset: options.contactSheetAsset!,
          mediaType: sheet.mediaType,
          columns: sheet.columns,
          rows: sheet.rows,
          tile: sheet.tile,
          frames: sheet.frames.map((frame) => ({ at: at(frame), slotId: slotAt(frame).id })),
        }
      : null,
    language: draft.language,
    ...(draft.doubts && draft.doubts.length > 0 ? { doubts: draft.doubts } : {}),
    ...(draft.subjects ? { subjects: draft.subjects } : {}),
  };
  const parsed = templateSchema.safeParse(candidate);
  // FRM1-OVL: each designed overlay's relation to the reel's people, for placement to keep.
  return parsed.success
    ? ok(withOverlayRelations(parsed.data))
    : err(ValidationError({ field: 'template' }, { detail: z.prettifyError(parsed.error) }));
}
