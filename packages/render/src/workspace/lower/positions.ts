// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where GSAP places each child of a timeline (HFW1 lower), as `Timeline._parsePosition` and `_addToTimeline` do in
 * gsap-core 3.15: seconds; a label; `+=s`/`-=s` from the timeline's end; `label+=s`; `<` and `>` (with an offset)
 * from the start and end of the child added last; no position, the timeline's end. A child starts at its position
 * plus its `delay`, and lasts its duration plus its stagger, times its repeats, with the repeat delay between them.
 * HyperFrames' parser walks positions without delays, repeats or staggers, so the lowering places tweens with this
 * instead. A child whose length is not known here (a stagger over a split's words, whose count depends on the words
 * a use sets) leaves the end unknown: a position read from it is refused.
 */

export type TimelineCall =
  | { readonly kind: 'label'; readonly name: string; readonly position: number | string | undefined }
  | {
      readonly kind: 'tween';
      /** Undefined: no position written. */
      readonly position: number | string | undefined;
      readonly delay: number;
      /** Seconds from its start to its end, repeats included; null when it depends on the words. */
      readonly length: number | null;
    };

export interface Placement {
  /** Each tween's start, in call order (null where it could not be placed). */
  readonly starts: readonly (number | null)[];
  /** Each placed label, at seconds. */
  readonly labels: ReadonlyMap<string, number>;
  /** Positions that could not be placed: the call's index and why. */
  readonly problems: readonly {
    readonly index: number;
    readonly reason: 'percent' | 'unknownEnd' | 'negative';
  }[];
}

const round = (value: number) => Math.round(value * 1e7) / 1e7 || 0;

/** Places every call (tweens and labels, in the order the script makes them). */
export function placeCalls(calls: readonly TimelineCall[]): Placement {
  const labels = new Map<string, number>();
  const starts: (number | null)[] = [];
  const problems: { index: number; reason: 'percent' | 'unknownEnd' | 'negative' }[] = [];
  /** The timeline's end so far (the latest end of a child), null once a child's end is unknown. */
  let end: number | null = 0;
  /** The child added last. */
  let recent: { start: number; end: number | null } = { start: 0, end: 0 };

  /** A position as seconds; null when it reads an end that is unknown; 'percent' for a percent offset. */
  const parse = (position: number | string | undefined): number | null | 'percent' => {
    if (position === undefined) return end;
    if (typeof position === 'number') return position;
    const text = position.trim();
    if (!Number.isNaN(Number(text)) && text !== '' && !labels.has(text)) return Number(text);
    if (text.endsWith('%')) return 'percent';
    const first = text.charAt(0);
    if (first === '<' || first === '>') {
      const offset = Number.parseFloat(text.slice(1).replace('=', '')) || 0;
      const base = first === '<' ? recent.start : recent.end;
      return base === null ? null : base + offset;
    }
    const equals = text.indexOf('=');
    if (equals < 0) {
      // GSAP adds a label it does not know at the timeline's end.
      if (!labels.has(text)) {
        if (end === null) return null;
        labels.set(text, end);
      }
      return labels.get(text) ?? null;
    }
    const offset = Number.parseFloat(text.charAt(equals - 1) + text.slice(equals + 1));
    if (!Number.isFinite(offset)) return null;
    const base = equals > 1 ? parse(text.slice(0, equals - 1)) : end;
    return typeof base === 'number' ? base + offset : base;
  };

  let tweenIndex = 0;
  calls.forEach((call) => {
    const at = parse(call.position);
    if (call.kind === 'label') {
      if (typeof at === 'number') labels.set(call.name, Math.max(0, round(at)));
      return;
    }
    const tween = tweenIndex++;
    if (typeof at !== 'number') {
      problems.push({ index: tween, reason: at === 'percent' ? 'percent' : 'unknownEnd' });
      starts.push(null);
      end = null;
      recent = { start: 0, end: null };
      return;
    }
    const start = round(at + call.delay);
    if (start < 0) problems.push({ index: tween, reason: 'negative' });
    starts.push(start < 0 ? null : start);
    const finish = call.length === null ? null : round(start + call.length);
    end = end === null || finish === null ? null : Math.max(end, finish);
    recent = { start, end: finish };
  });
  return { starts, labels, problems };
}

/** A tween's length: its duration plus its stagger, times its repeats, with the repeat delay between them. */
export function tweenLength(
  duration: number,
  stagger: number | null,
  repeat: { readonly count: number; readonly delay: number } | undefined,
): number | null {
  if (stagger === null) return null;
  const once = duration + stagger;
  return repeat ? once * (repeat.count + 1) + repeat.delay * repeat.count : once;
}

/**
 * The time a stagger spreads its targets over (gsap-core's `distribute`, in one dimension): `amount`, or `each`
 * between neighbours over n targets, whatever order it starts from; nothing for one target.
 */
export function staggerSpread(
  stagger: { readonly each?: number; readonly amount?: number },
  count: number,
): number {
  if (count <= 1) return 0;
  return stagger.amount ?? (stagger.each ?? 0) * (count - 1);
}
