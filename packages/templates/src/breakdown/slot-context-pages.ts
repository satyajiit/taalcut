// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How many slots templates.resolveCuts hands out at a time (LRN1-CTX, SPEC "Writing the slots a page at a time"): the
 * largest page whose measured worst case leaves PAGE_SPARE_TOKENS of the window spare. A page's peak is the prompt of
 * the turn that writes its templates.setIntents call, plus that call: the Analyst's system prompt and tools, memory
 * at its cap for the window (agent SPEC 33), the saved-progress note, the previous page's setIntents, this page's
 * resolveCuts, a look per slot and the new intents. It grows by about the same amount a slot (`slot`), from a base;
 * both grow with the window, through memory's cap and the slot context caps (slotContextLimitsFor).
 *
 * Measured on the shipped runtime (llama-server b11571 with the sidecar's chat template and its tokenizer, Qwen3.5
 * 4B), every part at its worst case: each slot's context at its window's caps, a look's answer at the low-detail cap
 * (vision's LOW_DETAIL_ANSWER_TOKENS), intents at INTENT_LIMITS (`_orch/lrn1/logs/ctx/budget5/paged5.py`; the table
 * is in the SPEC, the peaks in `test/fixtures/page-peaks.json`). The constants of the smallest measured window at or
 * above the model's are used: memory's cap and the context caps only grow with the window, so they never
 * undercount; above the largest, both are at their fixed caps, so its constants hold.
 */

/** Tokens a page leaves spare in the window: room for a description or an intent longer than measured. */
export const PAGE_SPARE_TOKENS = 400;

/** The largest page: templates.setIntents takes at most this many intents. */
export const MAX_SLOT_PAGE = 20;

/**
 * The longest intent templates.setIntents takes (one plain line, a short subject and place), so a page's intents,
 * which its worst case counts at these lengths, can't run longer than measured.
 */
export const INTENT_LIMITS = { textChars: 200, subjectChars: 60, placeChars: 60, reelChars: 160 } as const;

/**
 * The most bytes of JSON a page may take. The agent's tool executor stores a larger output as an artifact and the
 * model gets a one-line summary instead (packages/tools DEFAULT_INLINE_OUTPUT_LIMIT; templates can't import it, so
 * apps/gate-demo's test holds the two equal): a page with a lot of on-screen text and speech, or Devanagari's three
 * bytes a character, is cut short to fit.
 */
export const PAGE_MAX_BYTES = 8 * 1024;

/**
 * The window assumed when the model's isn't known: the smallest a local tier runs (packages/models contextWindowFor,
 * the Recommended tier's with the q8_0 KV cache; templates can't import it, so apps/desktop's
 * test/model-windows.test.ts holds the two equal).
 */
export const SMALLEST_WINDOW = 12_288;

interface PagePeaks {
  readonly window: number;
  readonly base: number;
  readonly slot: number;
}

/** The largest window measured: above it, memory and the slot context are at their fixed caps. */
const LARGEST_MEASURED: PagePeaks = { window: 32_768, base: 6_159, slot: 1_044 };

/**
 * Measured worst-case peak of a page of k slots at each window: `base` + k × `slot`. `slot` is the most one more slot
 * added to a page of 1 to 7 (which the byte cap leaves whole); `base` is the most any measured page of 1 to 20 is
 * above k × `slot`, so the rule never counts a measured page lower.
 */
export const PAGE_PEAKS: readonly PagePeaks[] = [
  { window: 8_192, base: 5_393, slot: 881 },
  { window: 12_288, base: 5_667, slot: 945 },
  { window: 16_384, base: 5_998, slot: 963 },
  { window: 24_576, base: 6_159, slot: 1_027 },
  LARGEST_MEASURED,
];

/**
 * The worst-case peak of a page of `slots` at this window, by the measured rule: the constants of the smallest
 * measured window at or above it, else the largest.
 */
export function pagePeak(window: number, slots: number): number {
  const peaks = PAGE_PEAKS.find((entry) => entry.window >= window) ?? LARGEST_MEASURED;
  return peaks.base + slots * peaks.slot;
}

/**
 * Slots a page holds at this window (unknown: the smallest local one): the largest page whose peak leaves
 * PAGE_SPARE_TOKENS spare, at least 1 and at most MAX_SLOT_PAGE.
 */
export function slotPageFor(window: number | undefined): number {
  const at = window ?? SMALLEST_WINDOW;
  let page = 1;
  while (page < MAX_SLOT_PAGE && pagePeak(at, page + 1) + PAGE_SPARE_TOKENS <= at) page += 1;
  return page;
}

/** The longest start of `slots` whose output, as `render` builds it, stays within PAGE_MAX_BYTES (one at least). */
export function fitPage<T>(slots: readonly T[], render: (page: readonly T[]) => unknown): T[] {
  for (let n = slots.length; n > 1; n -= 1) {
    const page = slots.slice(0, n);
    if (new TextEncoder().encode(JSON.stringify(render(page))).length <= PAGE_MAX_BYTES) return page;
  }
  return slots.slice(0, 1);
}
