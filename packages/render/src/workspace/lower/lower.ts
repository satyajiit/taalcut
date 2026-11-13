// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A composition's script as Taalcut motion data (HFW1 lower, Tier A: no model-written script runs). HyperFrames'
 * own parser (`parseGsapScriptAcorn`, `@hyperframes/parsers`) reads the one timeline's tweens and timeline defaults;
 * Taalcut checks the script holds nothing but those (statements.ts), lowers each tween against the composition's
 * own markup (tween.ts: targets, values, ease, stagger, delay, repeat, keyframes, motion paths; splits.ts), and
 * places every call as GSAP does (positions.ts, calls.ts), delays, repeats and staggers included. Times are seconds from the composition's
 * start; the fold (compile/layers/compositions.ts) moves them to the item's place. The `enter` and `exit` labels
 * are kept so a longer or shorter item moves the exit with its end. Every refusal says what to write instead.
 */
import {
  parseGsapScriptAcorn,
  parseGsapScriptAcornForWrite,
  scriptShape,
} from '@hyperframes/parsers/gsap-parser-acorn';
import type { MarkupNode } from '../html/markup';
import type { MotionTween, SplitSpec } from '../../motion/motion-data';
import { excerpt, refusal, type WorkspaceFinding } from '../gate/finding';
import { callOrder, labelCalls, POSITION_HINTS, POSITION_PROBLEMS, timelineDefaultsEase } from './calls';
import { placeCalls, type TimelineCall } from './positions';
import { readSplits } from './splits';
import { checkStatements, forbiddenUses, type Node } from './statements';
import { indexTargets } from './targets';
import { lowerTween, type TweenPlan } from './tween';

export const LOWER_LIMITS = { tweens: 300 } as const;

export interface LoweredMotion {
  /** Tweens in script order, at seconds from the composition's start, targeting authored (or generated) ids. */
  readonly tweens: readonly MotionTween[];
  readonly splits: readonly SplitSpec[];
  /** Where `enter` and `exit` sit (seconds), when the script adds them. */
  readonly labels: { readonly enter?: number; readonly exit?: number };
  /** Ids given to targeted elements without one. */
  readonly generatedIds: ReadonlyMap<MarkupNode, string>;
}

export type Lowered = { ok: true; motion: LoweredMotion } | { ok: false; findings: WorkspaceFinding[] };

/** Lowers a composition's script against its markup; every refusal when it can't. */
export function lowerScript(
  script: string,
  root: MarkupNode,
  maxTweens: number = LOWER_LIMITS.tweens,
  cubicPaths = false,
): Lowered {
  if (scriptShape(script) === null)
    return {
      ok: false,
      findings: [
        refusal(
          'lower.syntax',
          'the script does not parse as JavaScript',
          'Fix the syntax: one plain script, no modules or imports.',
        ),
      ],
    };
  const parsed = parseGsapScriptAcorn(script);
  const write = parseGsapScriptAcornForWrite(script);
  const findings: WorkspaceFinding[] = [];
  if (!write || !write.hasTimeline)
    return {
      ok: false,
      findings: [
        refusal(
          'lower.noTimeline',
          'the script makes no gsap.timeline',
          'Build one timeline: const tl = gsap.timeline({ paused: true });',
        ),
      ],
    };
  if (parsed.multipleTimelines)
    findings.push(
      refusal(
        'lower.multipleTimelines',
        'the script makes more than one timeline',
        'Build one paused timeline and put every tween on it.',
      ),
    );
  if (parsed.unsupportedTimelinePattern)
    findings.push(
      refusal(
        'lower.unsupportedTimelinePattern',
        'the timeline is not a named constant',
        'Write const tl = gsap.timeline({ paused: true }); and call tl.to(…) on it.',
      ),
    );
  const program = write.ast as Node;
  findings.push(...forbiddenUses(program, script));
  const shape = checkStatements(program, script, write.timelineVar);
  findings.push(...shape.findings);
  if (parsed.animations.length !== write.located.length)
    findings.push(
      refusal(
        'lower.scriptShape',
        'the script builds tweens in loops or helper functions',
        'Write each tween as its own call (use stagger for groups).',
      ),
    );
  if (parsed.animations.length > maxTweens)
    findings.push(
      refusal(
        'lower.limit',
        `the script has ${parsed.animations.length} tweens`,
        `Use at most ${maxTweens} tweens (stagger counts as one).`,
      ),
    );
  if (findings.length > 0) return { ok: false, findings };
  const index = indexTargets(root);
  const splits = readSplits(shape.splits, index, findings);
  const context = { splits, index, defaultsEase: timelineDefaultsEase(program), cubicPaths };
  const plans: (TweenPlan | null)[] = parsed.animations.map((animation, at) => {
    const located = write.located[at];
    const node = located?.call.node as Node | undefined;
    const argument = (node?.arguments as Node[] | undefined)?.[0];
    return lowerTween(
      animation,
      located?.animation,
      { argument, vars: located?.call.varsArg as Node | undefined },
      context,
      findings,
    );
  });
  // Every call in the order the script makes them: tweens and labels, so positions are placed as GSAP places them.
  const ordered: { order: number; call: TimelineCall }[] = [
    ...labelCalls(program, write.timelineVar, findings),
    ...parsed.animations.map((animation, at) => ({
      order: callOrder(write.located[at]?.call.node as Node | undefined),
      call: {
        kind: 'tween' as const,
        position: animation.implicitPosition ? undefined : animation.position,
        delay: plans[at]?.delay ?? 0,
        length: plans[at] ? (plans[at]?.length ?? null) : (animation.duration ?? 0.5),
      },
    })),
  ].sort((a, b) => a.order - b.order);
  const placed = placeCalls(ordered.map((entry) => entry.call));
  for (const problem of placed.problems) {
    const animation = parsed.animations[problem.index];
    const where = `tl.${animation?.method ?? 'to'}(${excerpt(animation?.targetSelector ?? '', 30)})`;
    findings.push(
      refusal(
        'lower.position',
        `${where} ${POSITION_PROBLEMS[problem.reason]}`,
        POSITION_HINTS[problem.reason],
      ),
    );
  }
  if (findings.length > 0) return { ok: false, findings };
  const tweens: MotionTween[] = plans.flatMap((plan, at) => plan?.build(placed.starts[at] ?? 0) ?? []);
  if (tweens.length > maxTweens)
    return {
      ok: false,
      findings: [
        refusal(
          'lower.limit',
          `the script makes ${tweens.length} tweens once its keyframes are unrolled`,
          `Use at most ${maxTweens} tweens (a keyframe is one per property it sets).`,
        ),
      ],
    };
  const enter = placed.labels.get('enter');
  const exit = placed.labels.get('exit');
  const labels = { ...(enter !== undefined ? { enter } : {}), ...(exit !== undefined ? { exit } : {}) };
  const splitSpecs: SplitSpec[] = [...splits.values()].flatMap((split) =>
    split.ids.map((id) => ({ id, ...split.spec })),
  );
  return { ok: true, motion: { tweens, splits: splitSpecs, labels, generatedIds: index.generated } };
}
