// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 (tpl): a template's graphics, designed once after its breakdown by the Designer (render SPEC "HFW1 tpl").
 * Each composition brief (one per overlay role) goes to the Designer with the reel's frames of its overlays. What
 * comes back passed the gate; it is drawn over the reel's own frame from just before its graphic came on, at the
 * moments the reel shows it entering and held, and the vision judge compares each with the reel's frame. Until they
 * match (or the rounds run out, keeping the last design that passed the gate), the differences and both frames go
 * back to the Designer. A kept composition's files are copied into the templates' pool; the template stores the
 * compositions and each overlay's use with its values. A role the Designer can't design gets none, with its reason:
 * there is no built-in design to fall back on. Never throws.
 */
import {
  newId,
  type AsyncResult,
  type GraphicComponents,
  type GraphicComposition,
  type GraphicParamValues,
  type ProjectId,
  type Template,
} from '@taalcut/core';
import { compositionBriefs, type CompositionBrief, type OverlayBrief } from './brief';
import { briefMarkdown } from './brief-text';
import type {
  DesignedComposition,
  DesignFeedback,
  DesignOverlay,
  DesignPicture,
  ReelFrame,
} from './designer';
import type { JudgedPair, JudgeReel } from './judge';

/** Stills of a composition with these values over a picture, at seconds into it, in order. */
export type DrawOver = (
  input: {
    readonly composition: GraphicComposition;
    readonly params: GraphicParamValues;
    readonly seconds: readonly number[];
    readonly over: DesignPicture;
  },
  signal?: AbortSignal,
) => AsyncResult<readonly DesignPicture[]>;

export interface TemplateCompositionDeps {
  /** The project whose workspace the Designer works in (the one the reel was made into a template from). */
  readonly projectId: ProjectId;
  readonly design: DesignOverlay;
  /** The reel's frames at a brief's moments (brief.frames), every overlay's; none when the reel can't be read. */
  readonly reelFrames: (brief: CompositionBrief) => Promise<readonly ReelFrame[]>;
  /** Without both, a design that passed the gate is kept unjudged. */
  readonly drawOver?: DrawOver;
  readonly judge?: JudgeReel;
  /** Copies a kept composition's files into the templates' pool; a failure leaves the composition out. */
  readonly keep: (composition: GraphicComposition, signal?: AbortSignal) => AsyncResult<void>;
  /** Designer rounds per composition, the judge's differences going back between them (default 3). */
  readonly rounds?: number;
  readonly signal?: AbortSignal;
  readonly onRound?: (brief: CompositionBrief, round: TemplateDesignRound) => void;
}

export interface TemplateDesignRound {
  readonly round: number;
  /** designed: passed the gate, not judged; matched / differs: the judge's verdict; none: no design came back. */
  readonly outcome: 'designed' | 'matched' | 'differs' | 'none';
  readonly detail?: string;
}

export interface TemplateDesignOutcome {
  readonly role: CompositionBrief['role'];
  readonly overlays: readonly OverlayBrief['overlayId'][];
  readonly composition: GraphicComposition | null;
  /** The judge's last verdict: null when it didn't judge. */
  readonly matched: boolean | null;
  /** Why there is no composition, in plain words; null when there is one. */
  readonly reason: string | null;
  readonly rounds: number;
}

export const TEMPLATE_DESIGN_ROUNDS = 3;

/** The frames of the lead overlay the judge compares, and the reel frame the design is drawn over. */
function judgedMoments(brief: OverlayBrief, reel: readonly ReelFrame[]) {
  const of = (seconds: number | undefined) =>
    seconds === undefined
      ? undefined
      : reel.find((frame) => frame.overlayId === brief.overlayId && Math.abs(frame.seconds - seconds) < 1e-3);
  const before = of(brief.frames.entrance[0]);
  const moments = [
    { moment: 'entering, two frames in', frame: of(brief.frames.entrance[2]) },
    { moment: 'held', frame: of(brief.frames.hold[0]) },
  ].filter((entry): entry is { moment: string; frame: ReelFrame } => entry.frame !== undefined);
  return { before, moments };
}

/** Each overlay's values: the Designer's, with its own words in the first text variable. */
function usesOf(brief: CompositionBrief, designed: DesignedComposition, id: GraphicComposition['id']) {
  const words = designed.composition.variables.find((variable) => variable.type === 'text');
  return brief.overlays.map((overlay) => ({
    overlayId: overlay.overlayId,
    compositionId: id,
    params: {
      ...(designed.params[overlay.overlayId] ?? {}),
      ...(words ? { [words.name]: overlay.words } : {}),
    },
  }));
}

async function judged(
  brief: CompositionBrief,
  designed: DesignedComposition,
  reel: readonly ReelFrame[],
  deps: TemplateCompositionDeps,
): Promise<{ matches: boolean; feedback: DesignFeedback } | null> {
  const { drawOver, judge } = deps;
  const lead = brief.overlays[0]!;
  const { before, moments } = judgedMoments(lead, reel);
  if (!drawOver || !judge || !before || moments.length === 0) return null;
  const { composition } = designed;
  const params = usesOf(brief, designed, composition.id)[0]!.params;
  const seconds = moments.map(
    (entry) =>
      Math.round(
        Math.min(composition.durationSeconds, Math.max(0, entry.frame.seconds - lead.timing.appearsSeconds)) *
          1000,
      ) / 1000,
  );
  const drawn = await drawOver({ composition, params, seconds, over: before.picture }, deps.signal);
  if (!drawn.ok || drawn.value.length !== moments.length) return null;
  const pairs: JudgedPair[] = moments.map((entry, index) => ({
    moment: entry.moment,
    reel: entry.frame.picture,
    design: drawn.value[index]!,
  }));
  const verdict = await judge({ brief: lead, pairs }, deps.signal);
  if (!verdict.ok) return null;
  return {
    matches: verdict.value.matches,
    feedback: {
      previous: composition,
      reason: `It doesn't match the reel yet: ${verdict.value.differences.join('; ') || 'the judge saw a difference'}.`,
      frames: pairs.flatMap((pair) => [
        { label: `the reel, ${pair.moment}`, picture: pair.reel },
        { label: `your design over the reel's shot, ${pair.moment}`, picture: pair.design },
      ]),
    },
  };
}

/** Designs one composition brief: the last gated design and the judge's last verdict, or the reason for none. */
async function designOne(brief: CompositionBrief, deps: TemplateCompositionDeps) {
  const rounds = Math.max(1, deps.rounds ?? TEMPLATE_DESIGN_ROUNDS);
  const reel = await deps.reelFrames(brief);
  const markdown = briefMarkdown(brief);
  let feedback: DesignFeedback | null = null;
  let kept: DesignedComposition | null = null;
  let matched: boolean | null = null;
  let reason: string | null = null;
  let round = 0;
  while (round < rounds && !deps.signal?.aborted) {
    round++;
    const answer = await deps.design(
      { projectId: deps.projectId, brief, markdown, reel, feedback },
      deps.signal,
    );
    if (!answer.ok || 'reason' in answer.value || !answer.value.designed.composition.gate.passed) {
      reason = !answer.ok
        ? `The Designer failed (${answer.error.code})`
        : 'reason' in answer.value
          ? answer.value.reason
          : 'Its design did not pass the gate';
      deps.onRound?.(brief, { round, outcome: 'none', detail: reason });
      break;
    }
    kept = answer.value.designed;
    const verdict = await judged(brief, kept, reel, deps);
    matched = verdict?.matches ?? null;
    deps.onRound?.(brief, {
      round,
      outcome: verdict === null ? 'designed' : verdict.matches ? 'matched' : 'differs',
      ...(verdict && !verdict.matches ? { detail: verdict.feedback.reason } : {}),
    });
    if (!verdict || verdict.matches) break;
    feedback = verdict.feedback;
  }
  return { kept, matched, reason: kept ? null : (reason ?? 'Stopped before a design came back'), round };
}

/** The roles of one conversation's bubbles. */
const CONVERSATION_ROLES: ReadonlySet<string> = new Set(['incomingMessage', 'outgoingMessage']);

/** Designs each role's composition; the graphics for `template.setGraphics`. */
export async function designTemplateCompositions(
  template: Template,
  deps: TemplateCompositionDeps,
): Promise<{ readonly graphics: GraphicComponents; readonly outcomes: readonly TemplateDesignOutcome[] }> {
  const compositions: GraphicComposition[] = [];
  const uses: GraphicComponents['uses'][number][] = [];
  const outcomes: TemplateDesignOutcome[] = [];
  // A conversation's bubbles share one type size and padding: the first designed sets them for the rest.
  let thread: CompositionBrief['thread'] | undefined;
  for (const briefed of compositionBriefs(template)) {
    if (deps.signal?.aborted) break;
    const conversation = CONVERSATION_ROLES.has(briefed.role);
    const brief = conversation && thread ? { ...briefed, thread } : briefed;
    const overlays = brief.overlays.map((overlay) => overlay.overlayId);
    const done = await designOne(brief, deps);
    if (conversation && !thread && done.kept?.type) thread = { role: brief.role, type: done.kept.type };
    let reason = done.reason;
    if (done.kept) {
      const kept = await deps.keep(done.kept.composition, deps.signal);
      if (kept.ok) {
        // Unique in the template whatever the Designer called it (one composition per role).
        const composition = { ...done.kept.composition, id: newId<'GraphicComposition'>() };
        compositions.push(composition);
        uses.push(...usesOf(brief, done.kept, composition.id));
        outcomes.push({
          role: brief.role,
          overlays,
          composition,
          matched: done.matched,
          reason: null,
          rounds: done.round,
        });
        continue;
      }
      reason = `Its files could not be kept with the template (${kept.error.code})`;
    }
    outcomes.push({
      role: brief.role,
      overlays,
      composition: null,
      matched: done.matched,
      reason,
      rounds: done.round,
    });
  }
  return { graphics: { uses, compositions }, outcomes };
}
