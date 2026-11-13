// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Analyst's stored progress on a breakdown (LRN1-CTX, SPEC "Writing the slots a page at a time"): its
 * verdicts on the disputed cuts and the intents it has written, in the breakdown's experiment folder beside
 * breakdown.json. templates.judgeCut stores a verdict at a time, and a long reel is written a page at a time:
 * templates.resolveCuts hands out the next slots that have no intent, templates.setIntents stores a page's intents,
 * and templates.finalise reads them all from here instead of carrying them in its call. Since what the model read to
 * judge or write them is stored, the agent shows those earlier turns as one line (agent SPEC "Saved progress"), and
 * the prompt stays the same size as the disputes and pages go by.
 *
 * An intent belongs to the slot's exact bounds: when new verdicts move a slot's cut, its intent no longer
 * applies and the slot is handed out again. The file goes with the experiment when it is finalised or abandoned.
 */
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createKeyedQueue,
  err,
  ok,
  SLOT_ROLES,
  UnknownError,
  ValidationError,
  type AsyncResult,
  type Result,
} from '@taalcut/core';
import { z } from 'zod';
import {
  analystIntentSchema,
  type CutVerdict,
  type ResolvedSlot,
  type SlotIntentInput,
} from './build-template';
import type { BreakdownDraft } from './draft';

export const PROGRESS_FILE = 'analyst-progress.json';

const storedIntentSchema = z.object({
  start: z.int().nonnegative(),
  end: z.int().positive(),
  intent: analystIntentSchema,
  role: z.enum(SLOT_ROLES).optional(),
  /** AGT1: a name went out of the intent with no general word for it (transferable-repair.ts). */
  generalised: z.literal(true).optional(),
});
const progressSchema = z.object({
  verdicts: z.array(z.object({ at: z.int().nonnegative(), cut: z.boolean() })).max(500),
  intents: z.array(storedIntentSchema).max(1000),
});
export type AnalystProgress = z.output<typeof progressSchema>;
type StoredIntent = z.output<typeof storedIntentSchema>;

const NOTHING_YET: AnalystProgress = { verdicts: [], intents: [] };

const isMissing = (cause: unknown) =>
  typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT';

/** The stored progress; a breakdown nothing was stored for yet has none. */
export async function readProgress(dir: string): AsyncResult<AnalystProgress> {
  let text: string;
  try {
    text = await readFile(join(dir, PROGRESS_FILE), 'utf8');
  } catch (cause) {
    if (isMissing(cause)) return ok(NOTHING_YET);
    return err(UnknownError(undefined, { detail: String(cause).slice(0, 300) }));
  }
  try {
    return ok(progressSchema.parse(JSON.parse(text)));
  } catch (cause) {
    return err(ValidationError({ field: PROGRESS_FILE }, { detail: String(cause).slice(0, 300) }));
  }
}

/** Writes in order per folder, so two calls in one turn can't drop each other's intents. */
const queues = createKeyedQueue();

/**
 * Reads, changes and writes the progress (whole file, then rename), one change at a time per folder. A change
 * that fails writes nothing.
 */
export function updateProgress(
  dir: string,
  change: (current: AnalystProgress) => Result<AnalystProgress>,
): AsyncResult<AnalystProgress> {
  const run = async (): AsyncResult<AnalystProgress> => {
    const current = await readProgress(dir);
    if (!current.ok) return current;
    const changed = change(current.value);
    if (!changed.ok) return changed;
    const next = progressSchema.safeParse(changed.value);
    if (!next.success)
      return err(
        ValidationError({ field: PROGRESS_FILE }, { detail: z.prettifyError(next.error).slice(0, 300) }),
      );
    const temporary = join(dir, `${PROGRESS_FILE}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(next.data));
      await rename(temporary, join(dir, PROGRESS_FILE));
    } catch (cause) {
      return err(UnknownError(undefined, { detail: String(cause).slice(0, 300) }));
    }
    return ok(next.data);
  };
  return queues.run(dir, run);
}

const sameBounds = (stored: StoredIntent, slot: Pick<ResolvedSlot, 'start' | 'end'>) =>
  stored.start === slot.start && stored.end === slot.end;

/** The stored intents of these slots, by slot index (the slots of the stored verdicts). */
export function intentsOf(progress: AnalystProgress, slots: readonly ResolvedSlot[]): SlotIntentInput[] {
  return slots.flatMap((slot) => {
    const stored = progress.intents.find((item) => sameBounds(item, slot));
    return stored
      ? [
          {
            slotIndex: slot.index,
            intent: stored.intent,
            ...(stored.role ? { role: stored.role } : {}),
            ...(stored.generalised ? { generalised: true } : {}),
          },
        ]
      : [];
  });
}

/** The slots that have no stored intent yet, in slot order. */
export function unwritten<T extends ResolvedSlot>(progress: AnalystProgress, slots: readonly T[]): T[] {
  return slots.filter((slot) => !progress.intents.some((item) => sameBounds(item, slot)));
}

/** The progress with this verdict stored, replacing an earlier one on the same cut. */
export const withVerdict = (progress: AnalystProgress, verdict: CutVerdict): AnalystProgress => ({
  ...progress,
  verdicts: [
    ...progress.verdicts.filter((item) => item.at !== verdict.at),
    { at: verdict.at, cut: verdict.cut },
  ],
});

/** The progress with these intents stored, each replacing what the same slot had. */
export function withIntents(
  progress: AnalystProgress,
  written: readonly { slot: ResolvedSlot; entry: Omit<SlotIntentInput, 'slotIndex'> }[],
): AnalystProgress {
  const fresh = written.map(({ slot, entry }) => ({
    start: slot.start,
    end: slot.end,
    // FRM1-MOT: the Analyst gives no motion now (the template measures it).
    intent: { ...entry.intent, motion: entry.intent.motion ?? null },
    ...(entry.role ? { role: entry.role } : {}),
    ...(entry.generalised ? { generalised: true as const } : {}),
  }));
  const kept = progress.intents.filter((item) => !fresh.some((other) => sameBounds(item, other)));
  return { ...progress, intents: [...kept, ...fresh].sort((a, b) => a.start - b.start) };
}

/**
 * The one frame to look at for a slot (experiment-relative), or null when the breakdown has none inside it. The
 * working frames belong to the provisional slots (first, middle and last frame; the middle alone on a long reel):
 * - the provisional slot that is exactly this one: its strip (BRK1: its first and last frame in one image, so one
 *   look shows how the shot moves), or its middle frame when it has none;
 * - the provisional slot that starts where this one does and ends no later: its middle frame;
 * - one that starts there but runs on (a verdict cut it): its first frame, the only one sure to be inside;
 * - a slot that starts at a disputed cut no provisional slot started at: the dispute's frame after the cut.
 */
export function slotFrame(draft: BreakdownDraft, slot: Pick<ResolvedSlot, 'start' | 'end'>): string | null {
  const provisional = draft.slotFrames.find((item) => item.start === slot.start);
  if (provisional?.strip && provisional.end === slot.end) return provisional.strip;
  if (provisional && provisional.end <= slot.end)
    return provisional.frames[Math.floor((provisional.frames.length - 1) / 2)] ?? null;
  if (provisional) return provisional.frames.length > 1 ? (provisional.frames[0] ?? null) : null;
  return draft.disputes.find((dispute) => dispute.frame === slot.start)?.after ?? null;
}
