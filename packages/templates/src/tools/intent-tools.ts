// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * templates.setIntents (P2-T5, LRN1-CTX): stores a page of the Analyst's intents, for templates.finalise.
 *
 * FIX-CAST: an intent must fit anyone's footage; the reel's places, landmarks and signs belong in `reel`. AGT1: the
 * tool no longer refuses an intent that names them. The local models could not mend such a line from the refusal
 * (35 to 39 refusals in five breakdowns of the owner's reel, one breakdown given up), and the mend is mechanical:
 * the tool rewrites it (`breakdown/transferable-repair.ts`), stores it, and says what it wrote, so the next page is
 * written that way. The model's own words are kept in `reel` for a slot without looks (finalise gives the others
 * their looks). A slot whose rewrite says too little, or a slot the breakdown doesn't have, is refused alone, with
 * the call to make; the page's other slots are stored.
 */
import { defineTool, err, NO_TOOL_RETRY, ok, ValidationError, type TaalcutError } from '@taalcut/core';
import { resolveCuts, type SlotIntentInput } from '../breakdown/build-template';
import { readLooks } from '../breakdown/looks';
import {
  intentsOf,
  slotFrame,
  unwritten,
  updateProgress,
  withIntents,
} from '../breakdown/slot-context-progress';
import { intentSpecifics, specificsMessage } from '../breakdown/transferable';
import { generaliseIntent, MIN_REWRITTEN_WORDS, type IntentRewrite } from '../breakdown/transferable-repair';

const TEXT_SHOTS: ReadonlySet<string> = new Set(['text', 'screen']);
import { SlotNotFound } from '../errors';
import type { DraftCache, TemplateToolDeps } from './deps';
import { setIntentsInputSchema, setIntentsOutputSchema } from './schemas';

const MINUTE = 60_000;
/** What `reel` keeps of the model's words: the store's limit (analystIntentSchema). */
const REEL_CHARS = 500;

/** Told with the rewritten intents, so the next page is written the same way. */
export const REWRITTEN_NOTE =
  "Taalcut rewrote these intents to fit anyone's footage (no place names, landmarks, brands or sign text) and " +
  "stored them; the reel's own words stay in reel. Write the next slots this way.";

type Entry = SlotIntentInput & { readonly intent: SlotIntentInput['intent'] & { readonly reel?: string } };

interface Prepared {
  readonly entry: Entry;
  readonly rewrites: readonly (IntentRewrite & { readonly slotIndex: number })[];
  /** Why the slot is not stored, with the call to make instead. */
  readonly refusal?: string;
}

const cutAtWord = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return (space > limit / 2 ? cut.slice(0, space) : cut).trim();
};

/** An entry as it will be stored: rewritten when it names the reel, refused when the rewrite says too little. */
function prepare(entry: Entry, hasLooks: boolean): Prepared {
  const { intent } = entry;
  // A text card's line may be shorter ("Title card."): its words are the overlay's.
  const generalised = generaliseIntent(
    intent,
    TEXT_SHOTS.has(intent.shotType ?? '') ? 2 : MIN_REWRITTEN_WORDS,
  );
  if (!generalised) return { entry, rewrites: [] };
  if (generalised.refused) {
    const example = {
      slotIndex: entry.slotIndex,
      intent: {
        ...intent,
        text: "<what the shot does, for anyone's footage: who is in it, what they do, the framing, the light>",
        subject: generalised.intent.subject,
        place: generalised.intent.place,
        reel: intent.reel ?? cutAtWord(intent.text, REEL_CHARS),
      },
    };
    return {
      entry,
      rewrites: [],
      refusal: `${specificsMessage(entry.slotIndex, intentSpecifics(intent))} Without them the line says too little. Send slot ${entry.slotIndex} again like this: ${JSON.stringify(example)}`,
    };
  }
  // A slot with looks keeps them as what the reel shows (finalise); one without keeps the model's own words.
  const reel =
    generalised.rewrites.length > 0
      ? (intent.reel ?? (hasLooks ? undefined : cutAtWord(intent.text, REEL_CHARS)))
      : intent.reel;
  return {
    entry: {
      ...entry,
      intent: { ...intent, ...generalised.intent, ...(reel ? { reel } : {}) },
      ...(generalised.dropped ? { generalised: true } : {}),
    },
    rewrites: generalised.rewrites.map((rewrite) => ({ ...rewrite, slotIndex: entry.slotIndex })),
  };
}

export function setIntentsTool(deps: TemplateToolDeps, drafts: DraftCache) {
  return defineTool({
    name: 'templates.setIntents',
    // 1.0.1 (LRN1-CTX): a shorter description; slotIndex at most 199 (a template's 200 slots).
    // 1.1.0 (FIX-CAST): an intent naming the reel's places, landmarks or signs is refused; `reel` keeps them.
    // 1.2.0 (AGT1): such an intent is rewritten and stored (`rewritten`, `note`); a slot that can't be is refused
    // alone, as is a slot the breakdown doesn't have; lengths past the page's budget are taken up to the store's.
    // 1.3.0 (FIX-HOOK): an intent says what its footage needs (`needs`) and whether the reel shows the face (`face`).
    version: '1.3.0',
    summary: "Stores the intents of a page of a breakdown's slots, for templates.finalise.",
    description:
      "Stores the intents of a page's slots, replacing what a slot had, and returns how many of all the slots " +
      'have one.',
    tags: ['breakdown', 'slots', 'intent'],
    input: setIntentsInputSchema,
    output: setIntentsOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    // What the model read to write these intents is stored now (agent SPEC "Saved progress").
    savesProgress: true,
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['scratch'], write: ['scratch'] } },
    run: async (input) => {
      const loaded = await drafts.load(input.breakdownId);
      if (!loaded.ok) return loaded;
      const { draft, dir } = loaded.value;
      const looks = await readLooks(dir);
      let missing: number[] = [];
      let total = 0;
      let prepared: Prepared[] = [];
      // The slots of the stored verdicts, read under the write: a resolveCuts in the same turn may change them.
      const stored = await updateProgress(dir, (current) => {
        const { slots } = resolveCuts(draft, current.verdicts);
        total = slots.length;
        missing = [...new Set(input.intents.map((e) => e.slotIndex).filter((index) => !slots[index]))];
        // The last intent given for a slot wins.
        const bySlot = new Map(input.intents.map((entry) => [entry.slotIndex, entry]));
        prepared = [...bySlot.values()].flatMap((entry) => {
          const slot = slots[entry.slotIndex];
          if (!slot) return [];
          const frame = slotFrame(draft, slot);
          return [prepare(entry, frame !== null && looks[frame] !== undefined)];
        });
        const written = prepared.flatMap(({ entry, refusal }) => {
          const slot = slots[entry.slotIndex];
          return slot && !refusal ? [{ slot, entry }] : [];
        });
        return ok(withIntents(current, written));
      });
      if (!stored.ok) return stored;
      const { slots } = resolveCuts(draft, stored.value.verdicts);
      const written = slots.length - unwritten(stored.value, slots).length;
      const refusals = prepared.flatMap((item) => (item.refusal ? [item.refusal] : []));
      const keptNote = (refused: number) =>
        input.intents.length > refused
          ? ` The page's other slots are stored (${written} of ${total} have an intent).`
          : ' Nothing was stored.';
      // AGT1: slots the breakdown doesn't have, beside ones it has, are left out with a note (the 9B sent 13 to 15
      // of 13); only a page of them all, or a refused slot, is refused.
      const extra =
        missing.length > 0
          ? `No slot ${missing.join(', ')}: this breakdown has slots 0 to ${total - 1}.`
          : '';
      if (refusals.length > 0 || (missing.length > 0 && missing.length >= input.intents.length))
        return err(refusal(missing, total, refusals, keptNote(missing.length + refusals.length)));
      const rewritten = prepared.flatMap((item) =>
        item.rewrites.map(({ slotIndex, field, to }) => ({ slotIndex, field, to })),
      );
      const same = sameLines(
        intentsOf(stored.value, slots),
        input.intents.map((entry) => entry.slotIndex),
      );
      const notes = [
        ...(extra ? [`${extra} Those were left out; the others are stored.`] : []),
        ...(same ? [same] : []),
        ...(rewritten.length > 0 ? [REWRITTEN_NOTE] : []),
      ];
      return ok({
        written,
        total: slots.length,
        ...(rewritten.length > 0 ? { rewritten } : {}),
        ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
      });
    },
  });
}

function refusal(
  missing: readonly number[],
  total: number,
  refusals: readonly string[],
  kept: string,
): TaalcutError {
  if (missing.length > 0)
    return SlotNotFound(undefined, {
      detail:
        `No slot ${missing.join(', ')}: this breakdown has slots 0 to ${total - 1}.${kept}` +
        (refusals.length > 0 ? ` ${refusals.join(' ')}` : ''),
    });
  return ValidationError({ field: 'intents' }, { detail: `${refusals.join(' ')}${kept}` });
}

const fold = (text: string) =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s.,;:!?]+/gu, ' ')
    .trim();

/**
 * AGT1: a note when a slot of this call reads word for word like another. Refusing a line for naming the reel used to
 * make the model write it again, and so differently; stored as rewritten, a montage's shots kept the model's one line
 * (y1: three slots "Man walks under wooden gate in park, day light."). Stored either way: this asks for them again.
 */
function sameLines(stored: readonly SlotIntentInput[], sent: readonly number[]): string | undefined {
  const bySlot = new Map(stored.map((item) => [item.slotIndex, fold(item.intent.text)]));
  const groups = new Map<string, number[]>();
  for (const [slot, text] of bySlot) groups.set(text, [...(groups.get(text) ?? []), slot]);
  const repeated = [...groups.values()].filter(
    (slots) => slots.length > 1 && slots.some((s) => sent.includes(s)),
  );
  if (repeated.length === 0) return undefined;
  const said = repeated.map((slots) => `slots ${slots.sort((a, b) => a - b).join(', ')}`).join('; ');
  return (
    `These read the same, word for word: ${said}. Send them again with templates.setIntents, each saying what ` +
    'changes from one to the next (the camera, the framing, what the person does, the light), so no two read the same.'
  );
}
