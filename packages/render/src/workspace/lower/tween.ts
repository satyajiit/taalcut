// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One tween call of a composition's script, lowered (HFW1 lower): its targets against the composition's markup,
 * its values, ease and stagger on tc.js's allowlists (vars.ts), its `delay`, finite `repeat` and `yoyo`, its
 * keyframes unrolled (keyframes.ts) and its motion path (motion-path.ts). It says how long it lasts so the script's
 * positions can be placed as GSAP places them (positions.ts), and builds its tweens once its start is known.
 */
import type { parseGsapScriptAcorn } from '@hyperframes/parsers/gsap-parser-acorn';
import {
  MAX_REPEATS,
  type MotionRepeat,
  type MotionTargets,
  type MotionTween,
  type MotionVars,
} from '../../motion/motion-data';
import { excerpt, refusal, type WorkspaceFinding } from '../gate/finding';
import { frameDurations, isLinearEase, unrollKeyframes, type KeyframeStep } from './keyframes';
import { lowerMotionPath, MOTION_PATH_HINT, motionPathNode } from './motion-path';
import { staggerSpread, tweenLength } from './positions';
import { SPLIT_UNITS, type Split, type SplitUnit } from './splits';
import type { Node } from './statements';
import { idsOf, selectElements, type TargetIndex } from './targets';
import { lowerEase, lowerStagger, lowerVars } from './vars';

export type Animation = ReturnType<typeof parseGsapScriptAcorn>['animations'][number];

/** GSAP's default duration. */
const DEFAULT_DURATION = 0.5;

/** A lowered call: how long it lasts from its start (null: it depends on the words), and its tweens from a start. */
export interface TweenPlan {
  readonly delay: number;
  readonly length: number | null;
  readonly build: (start: number) => MotionTween[];
}

/** A tween call's first argument as motion targets, or why not. */
function targetsOf(
  animation: Animation,
  argument: Node | undefined,
  splits: ReadonlyMap<string, Split>,
  index: TargetIndex,
): MotionTargets | string {
  if (argument?.type === 'MemberExpression') {
    const object = (argument.object as Node).name as string | undefined;
    const unit = ((argument.property as Node).name ?? (argument.property as Node).value) as string;
    const split = object ? splits.get(object) : undefined;
    if (split) {
      if (!(SPLIT_UNITS as readonly string[]).includes(unit)) return `targets ${object}.${unit}`;
      if (!split.spec.type.split(',').includes(unit))
        return `targets ${object}.${unit}, which the split does not make`;
      return { split: split.ids, unit: unit as SplitUnit };
    }
  }
  if (
    animation.hasUnresolvedSelector ||
    animation.hasPartialSelector ||
    animation.targetSelector === '__unresolved__'
  )
    return 'targets something the parser cannot resolve to elements';
  const elements = selectElements(index, animation.targetSelector);
  if (elements === null)
    return `targets "${excerpt(animation.targetSelector, 40)}", a selector form that is not supported`;
  if (elements.length === 0)
    return `targets "${excerpt(animation.targetSelector, 40)}", which matches no element`;
  return { ids: idsOf(index, elements) };
}

const EXTRAS_REFUSED: Readonly<Record<string, string>> = {
  snap: 'Remove snap: animate a property tc.js applies.',
  immediateRender: 'Remove immediateRender: tl.from and tl.fromTo already start from their first values.',
};
const EXTRAS_LOWERED = new Set(['stagger', 'overwrite', 'repeat', 'yoyo', 'repeatDelay']);

const raw = (value: unknown) => (typeof value === 'string' ? value.replace(/^__raw:/, '').trim() : value);

/** The tween's repeat, none, or why it does not lower. */
function repeatOf(animation: Animation): MotionRepeat | undefined | string {
  const extras = animation.extras ?? {};
  if (extras.repeat === undefined) return undefined;
  const count = animation.inspectionTiming?.repeat;
  if (count === -1) return 'repeats forever';
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > MAX_REPEATS)
    return `repeats ${String(raw(extras.repeat))} times`;
  const yoyo = extras.yoyo === undefined ? 'false' : raw(extras.yoyo);
  if (yoyo !== 'true' && yoyo !== 'false') return `sets yoyo to ${String(yoyo)}`;
  const delay = animation.inspectionTiming?.repeatDelay ?? 0;
  if (extras.repeatDelay !== undefined && (typeof delay !== 'number' || delay < 0))
    return `sets repeatDelay to ${String(raw(extras.repeatDelay))}`;
  return count === 0 ? undefined : { count, yoyo: yoyo === 'true', delay };
}

export interface TweenContext {
  readonly splits: ReadonlyMap<string, Split>;
  readonly index: TargetIndex;
  /** The timeline's `defaults.ease`, which GSAP gives a keyframed tween as a whole. */
  readonly defaultsEase: string | undefined;
  readonly cubicPaths?: boolean;
}

/** Lowers one tween call; its findings are pushed, and null comes back when there are any. */
export function lowerTween(
  animation: Animation,
  written: Animation | undefined,
  call: { readonly argument?: Node; readonly vars?: Node },
  context: TweenContext,
  findings: WorkspaceFinding[],
): TweenPlan | null {
  const where = `tl.${animation.method}(${excerpt(animation.targetSelector === '__unresolved__' ? 'split' : animation.targetSelector, 30)})`;
  const before = findings.length;
  const say = (code: string, message: string, hint: string) =>
    findings.push(refusal(code, `${where} ${message}`, hint));
  const duration = animation.method === 'set' ? 0 : (animation.duration ?? DEFAULT_DURATION);
  const delay = animation.inspectionTiming?.delay ?? 0;
  if (!Number.isFinite(delay) || delay < 0)
    say(
      'lower.delay',
      'has a delay that is not seconds',
      'Give delay as a number of seconds, or leave it out.',
    );
  // A dwell (`tl.to({}, { duration })`) only lengthens the timeline.
  if (animation.targetSelector === 'dwell/hold' && Object.keys(animation.properties).length === 0)
    return { delay, length: duration, build: () => [] };
  if (animation.global)
    say(
      'lower.globalSet',
      'is gsap.set, outside the timeline',
      'Set first states in CSS, or with tl.set(target, vars, 0).',
    );
  const targets = targetsOf(animation, call.argument, context.splits, context.index);
  if (typeof targets === 'string')
    say(
      'lower.target',
      targets,
      'Target elements of this composition by id or class ("#title", ".tag"), or a split’s lines, words or chars.',
    );
  if (animation.durationUnresolved)
    say(
      'lower.duration',
      'has a duration that is not a number',
      'Write the duration as a number of seconds.',
    );
  for (const key of Object.keys(animation.extras ?? {}))
    if (!EXTRAS_LOWERED.has(key)) say('lower.extra', `sets ${key}`, EXTRAS_REFUSED[key] ?? 'Remove it.');
  const repeated = repeatOf(animation);
  const repeat = typeof repeated === 'string' ? undefined : repeated;
  if (typeof repeated === 'string')
    say(
      'lower.repeat',
      repeated,
      `Repeat a whole number of times, at most ${MAX_REPEATS} (never -1), with yoyo true or false.`,
    );
  const stagger =
    animation.extras?.stagger === undefined ? undefined : lowerStagger(animation.extras.stagger, where);
  if (stagger && 'finding' in stagger) findings.push(stagger.finding);
  // The parser reads a point list as keyframes of its own; the write pass's keyframes are the script's.
  const pathNode = motionPathNode(call.vars);
  const keyframes = written?.keyframes?.fromMotionPath ? undefined : written?.keyframes;
  let steps: KeyframeStep[] = [];
  if ((written?.keyframes?.fromMotionPath || animation.arcPath) && !context.cubicPaths)
    say('lower.motionPath', 'follows a list of points', MOTION_PATH_HINT);
  if (written?.hasUnresolvedKeyframes)
    say(
      'lower.keyframes',
      'has keyframes that are not written out',
      'Write the keyframes as literal values.',
    );
  else if (keyframes) {
    const unrolled = unrollKeyframes(keyframes, duration, frameDurations(call.vars));
    const hint =
      'Use keyframes on a tl.to without stagger, repeat or other values, and ease each keyframe (or easeEach), ' +
      'not the tween: set ease: "none" on it when the timeline has a default ease.';
    if (typeof unrolled === 'string') say('lower.keyframes', unrolled, hint);
    else if (animation.method !== 'to' || stagger || repeat || Object.keys(animation.properties).length > 0)
      say('lower.keyframes', 'mixes keyframes with other values, a stagger or a repeat', hint);
    else if (!isLinearEase(keyframes.ease ?? animation.ease ?? context.defaultsEase))
      say('lower.keyframes', 'eases its keyframes as a whole', hint);
    else steps = unrolled;
  }
  const to = lowerVars(animation.properties, where);
  const from = lowerVars(animation.fromProperties ?? {}, where);
  const lowered = steps.map((step) => ({
    step,
    vars: lowerVars(step.properties, where),
    ease: lowerEase(step.ease, where),
  }));
  findings.push(...to.findings, ...from.findings);
  for (const entry of lowered) {
    findings.push(...entry.vars.findings);
    if ('finding' in entry.ease) findings.push(entry.ease.finding);
  }
  let toVars: MotionVars = to.vars;
  if (pathNode) {
    const path = lowerMotionPath(pathNode, context.index, context.cubicPaths);
    if ('problem' in path) say('lower.motionPath', path.problem, MOTION_PATH_HINT);
    else toVars = { ...toVars, motionPath: path };
  }
  const ease = animation.method === 'set' ? { ease: undefined } : lowerEase(animation.ease, where);
  if ('finding' in ease) findings.push(ease.finding);
  if (findings.length > before || typeof targets === 'string') return null;

  const spread =
    !stagger || !('stagger' in stagger)
      ? 0
      : 'ids' in targets
        ? staggerSpread(stagger.stagger, targets.ids.length)
        : null;
  const length =
    animation.method === 'set' ? 0 : steps.length > 0 ? duration : tweenLength(duration, spread, repeat);
  const timing = {
    targets,
    ...('ease' in ease && ease.ease !== undefined ? { ease: ease.ease } : {}),
    ...(stagger && 'stagger' in stagger ? { stagger: stagger.stagger } : {}),
    ...(repeat ? { repeat } : {}),
  };
  const build = (at: number): MotionTween[] => {
    if (steps.length > 0)
      return lowered.map(({ step, vars }) => ({
        targets,
        at: at + step.offset,
        duration: step.duration,
        from: {},
        to: vars.vars,
        ...(step.duration > 0 ? { ease: step.ease } : {}),
      }));
    switch (animation.method) {
      case 'set':
        return [{ targets, at, duration: 0, from: {}, to: toVars }];
      // GSAP renders a from or fromTo's first values as soon as it is made, so they show before it starts.
      case 'from':
        return [{ ...timing, at, duration, from: toVars, to: {}, method: 'from', immediateRender: true }];
      case 'fromTo':
        return [{ ...timing, at, duration, from: from.vars, to: toVars, immediateRender: true }];
      default:
        return [{ ...timing, at, duration, from: {}, to: toVars }];
    }
  };
  return { delay, length, build };
}
