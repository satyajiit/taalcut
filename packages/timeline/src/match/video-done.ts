// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: `video.done`'s verdict, as `design.done` and `checkDesigns` do for a graphic. A made video is done when
 * the newest draft is of the timeline as it is, and nothing fails on it: no slot-match check (core's
 * SLOT_MATCH_CHECK_IDS, which warn in QA so the person may still deliver) on any slot, and no other QA check. A slot
 * may stay as it is with a stated reason (no clip in the library shows its need, the person asked for it); a failing
 * check the person may export over (`overridable`) may too; one the person may not, never. The refusal lists every failing slot with what differs and the tools its
 * fix names, so the next round starts from it. Render's `video.done` tool and the Maker's check both call this.
 * Pure.
 */
import {
  SLOT_MATCH_CHECK_IDS,
  type QaCheckId,
  type QaCheckResult,
  type QaReport,
  type SkillVerdict,
  type Timeline,
} from '@taalcut/core';
import { positions, videoItems } from '../model/sequence';

export interface VideoDoneReason {
  /** The slot, numbered from 1 in the template's order. */
  readonly slot?: number;
  /** Or a failing QA check that isn't a slot's (only one the person may export over). */
  readonly check?: QaCheckId;
  readonly reason: string;
}

/** The newest draft of the timeline (render.draft's render). */
export interface VideoDoneDraft {
  readonly renderId: string;
  readonly timelineRevision: number;
  readonly report: QaReport | null;
}

export interface VideoDoneInput {
  readonly timeline: Timeline;
  /** The template's slots in order (their numbers); null when the timeline follows none. */
  readonly slots: readonly { readonly id: string }[] | null;
  readonly draft: VideoDoneDraft | null;
  readonly reasons: readonly VideoDoneReason[];
}

export interface VideoDoneOutcome {
  readonly verdict: SkillVerdict;
  /** Slots the draft was held to, and those left with a reason. */
  readonly slots: number;
  readonly waived: readonly number[];
  /** Whether the slot checks measured anything (false: the draft wasn't compared with its reel). */
  readonly compared: boolean;
}

const SLOT_CHECKS = new Set<QaCheckId>(SLOT_MATCH_CHECK_IDS);
/** The most failing slots the refusal spells out; the rest are counted. */
const LISTED = 12;

const retry = (reason: string): SkillVerdict => ({ verdict: 'retry', reason });

/** A fix's params as words: key=value, in order. */
const paramsText = (params: Readonly<Record<string, string | number>>) =>
  Object.entries(params)
    .filter(([key]) => key !== 'slot' && key !== 'slotId')
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');

interface SlotFailure {
  readonly check: QaCheckId;
  readonly words: string;
}

/** The slot a finding is about: its target (a clip or gap on V1, or the slot itself), else its first frame. */
function findingSlot(
  finding: QaCheckResult['findings'][number],
  itemSlots: ReadonlyMap<string, string | null>,
  slotIds: ReadonlySet<string>,
  spans: readonly { start: number; end: number; slotId: string | null }[],
): string | null {
  const id = finding.target?.id;
  if (id && slotIds.has(id)) return id;
  if (id && itemSlots.get(id)) return itemSlots.get(id) ?? null;
  const frame = finding.frames?.start;
  if (frame === undefined) return null;
  return spans.find((span) => frame >= span.start && frame < span.end)?.slotId ?? null;
}

/** Each failing slot's checks, by slot id; and the failing slot checks no finding placed. */
function slotFailures(input: VideoDoneInput, failing: readonly QaCheckResult[]) {
  const items = videoItems(input.timeline);
  const itemSlots = new Map<string, string | null>(
    items.flatMap((item) => (item.type === 'transition' ? [] : [[item.id as string, item.slotId] as const])),
  );
  const spans = positions(items).map((position) => ({
    start: position.start,
    end: position.end,
    slotId: position.item.slotId as string | null,
  }));
  const slotIds = new Set((input.slots ?? []).map((slot) => slot.id));
  const bySlot = new Map<string, SlotFailure[]>();
  const unplaced: QaCheckId[] = [];
  for (const check of failing.filter((entry) => SLOT_CHECKS.has(entry.id))) {
    // Each slot's fixes in order: a slot's findings are in the same order (two reel graphics in one slot, say), so
    // the n-th finding of a slot takes the n-th fix that names it.
    const fixes = new Map<string, string[]>();
    for (const fix of check.fixes)
      if (fix.kind === 'agent' && typeof fix.params.slotId === 'string')
        fixes.set(fix.params.slotId, [...(fixes.get(fix.params.slotId) ?? []), paramsText(fix.params)]);
    let placed = false;
    for (const finding of check.findings) {
      const slotId = findingSlot(finding, itemSlots, slotIds, spans);
      if (!slotId) continue;
      placed = true;
      const measured = finding.measured ? `${finding.measured.value} ${finding.measured.unit}` : 'differs';
      const words = fixes.get(slotId)?.shift() ?? measured;
      bySlot.set(slotId, [...(bySlot.get(slotId) ?? []), { check: check.id, words }]);
    }
    if (!placed) unplaced.push(check.id);
  }
  return { bySlot, unplaced };
}

export function checkVideoDone(input: VideoDoneInput): VideoDoneOutcome {
  const slotCount = input.slots?.length ?? 0;
  const outcome = (verdict: SkillVerdict, waived: number[] = [], compared = false): VideoDoneOutcome => ({
    verdict,
    slots: slotCount,
    waived,
    compared,
  });
  const { timeline, draft } = input;
  if (!draft)
    return outcome(
      retry(
        `There is no draft of this timeline yet: render.draft revision ${timeline.revision}, then video.done.`,
      ),
    );
  if (draft.timelineRevision !== timeline.revision)
    return outcome(
      retry(
        `The newest draft (${draft.renderId}) shows revision ${draft.timelineRevision}, and the timeline is at ` +
          `${timeline.revision}: render.draft revision ${timeline.revision}, read its checks, then video.done.`,
      ),
    );
  const report = draft.report;
  if (!report)
    return outcome(retry(`The draft ${draft.renderId} has no QA report yet: let render.draft finish.`));
  const overridden = new Set(report.overrides.map((entry) => entry.check));
  // A slot check that misses warns in QA (the person may deliver it); video.done holds the AI to it all the same.
  const failing = report.checks.filter(
    (check) =>
      !overridden.has(check.id) &&
      (check.status === 'fail' || (check.status === 'warn' && SLOT_CHECKS.has(check.id))),
  );
  const compared = report.checks.some((check) => SLOT_CHECKS.has(check.id) && check.status !== 'skipped');
  const number = new Map((input.slots ?? []).map((slot, index) => [slot.id, index + 1]));
  const explained = new Set(input.reasons.flatMap((entry) => (entry.slot !== undefined ? [entry.slot] : [])));
  const explainedChecks = new Set(input.reasons.flatMap((entry) => (entry.check ? [entry.check] : [])));

  const { bySlot, unplaced } = slotFailures(input, failing);
  const open = [...bySlot.entries()]
    .map(([slotId, failures]) => ({ slot: number.get(slotId) ?? 0, slotId, failures }))
    .filter((entry) => !explained.has(entry.slot))
    .sort((a, b) => a.slot - b.slot);
  const waived = [...bySlot.keys()]
    .map((slotId) => number.get(slotId) ?? 0)
    .filter((slot) => explained.has(slot))
    .sort((a, b) => a - b);
  const others = failing.filter((check) => !SLOT_CHECKS.has(check.id) || unplaced.includes(check.id));
  const blocking = others.filter((check) => !check.overridable || !explainedChecks.has(check.id));
  if (open.length === 0 && blocking.length === 0) return outcome({ verdict: 'pass' }, waived, compared);

  const lines: string[] = [];
  for (const entry of open.slice(0, LISTED))
    lines.push(
      `slot ${entry.slot}: ${entry.failures.map((failure) => `${failure.check} (${failure.words})`).join('; ')}`,
    );
  if (open.length > LISTED) lines.push(`and ${open.length - LISTED} more slots`);
  for (const check of blocking) {
    const fixes = check.fixes.map((fix) =>
      fix.kind === 'agent'
        ? `${fix.instructionKey} ${paramsText(fix.params)}`
        : fix.kind === 'command'
          ? fix.command
          : fix.action,
    );
    lines.push(
      `${check.id}${check.overridable ? '' : ' (must be fixed)'}${fixes.length > 0 ? `: ${fixes.join('; ')}` : ''}`,
    );
  }
  return outcome(
    retry(
      `The draft ${draft.renderId} of revision ${draft.timelineRevision} still fails. ${lines.join('. ')}. Fix each ` +
        'with the tools its fix names, render.draft again and call video.done; or, where a slot must stay as it is ' +
        '(no clip in the library shows its need), give that slot a reason.',
    ),
    waived,
    compared,
  );
}
