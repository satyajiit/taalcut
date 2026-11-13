// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A small reader of the FFmpeg expressions media builds for `select` (EAR1-G3): numbers, variables, `+`, and
 * the functions `eq`, `between`, `lt`, `gte`, `gt` and `if`, evaluated as libavutil/eval.c does (comparisons
 * with NaN are false, `if` takes only its branch and treats NaN as true), with its depth rule: a number or a
 * variable is level 0, a function one above its deepest argument, a `+` one above its deeper side. FFmpeg 9.0.2
 * refuses an expression deeper than 100 (`MAX_DEPTH`).
 */

export const FFMPEG_MAX_DEPTH = 100;

export interface ParsedExpression {
  readonly depth: number;
  readonly evaluate: (vars: Readonly<Record<string, number>>) => number;
}

type Vars = Readonly<Record<string, number>>;
type Node = ParsedExpression;

const truth = (value: boolean) => (value ? 1 : 0);

const FUNCTIONS: Record<string, (args: readonly Node[], vars: Vars) => number> = {
  eq: ([a, b], vars) => truth(a!.evaluate(vars) === b!.evaluate(vars)),
  lt: ([a, b], vars) => truth(a!.evaluate(vars) < b!.evaluate(vars)),
  gte: ([a, b], vars) => truth(a!.evaluate(vars) >= b!.evaluate(vars)),
  gt: ([a, b], vars) => truth(a!.evaluate(vars) > b!.evaluate(vars)),
  between: ([x, low, high], vars) => {
    const value = x!.evaluate(vars);
    return truth(value >= low!.evaluate(vars) && value <= high!.evaluate(vars));
  },
  // C's truth: NaN is not 0.
  if: ([condition, then, otherwise], vars) =>
    condition!.evaluate(vars) !== 0 ? then!.evaluate(vars) : (otherwise?.evaluate(vars) ?? 0),
};

/** Parses `text` as a filter graph carries it (commas escaped `\,`). Throws on anything else. */
export function parseExpression(text: string): ParsedExpression {
  const src = text.replaceAll('\\,', ',');
  let at = 0;
  const match = (pattern: RegExp) => {
    pattern.lastIndex = at;
    const found = pattern.exec(src);
    if (found) at = pattern.lastIndex;
    return found?.[0];
  };
  const take = (token: string) => {
    if (!src.startsWith(token, at)) throw new Error(`expected ${token} at ${at}: ${src.slice(at, at + 24)}`);
    at += token.length;
  };
  const primary = (): Node => {
    const number = match(/-?\d+(?:\.\d+)?/y);
    if (number !== undefined) return { depth: 0, evaluate: () => Number(number) };
    const name = match(/[a-z_]+/y);
    if (name === undefined) throw new Error(`unexpected text at ${at}: ${src.slice(at, at + 24)}`);
    if (src[at] !== '(') return { depth: 0, evaluate: (vars) => vars[name] ?? Number.NaN };
    const call = FUNCTIONS[name];
    if (!call) throw new Error(`unknown function ${name}`);
    take('(');
    const args = [sum()];
    while (src[at] === ',') {
      at += 1;
      args.push(sum());
    }
    take(')');
    return { depth: Math.max(...args.map((arg) => arg.depth)) + 1, evaluate: (vars) => call(args, vars) };
  };
  const sum = (): Node => {
    let left = primary();
    while (src[at] === '+') {
      at += 1;
      const before = left;
      const right = primary();
      left = {
        depth: Math.max(before.depth, right.depth) + 1,
        evaluate: (vars) => before.evaluate(vars) + right.evaluate(vars),
      };
    }
    return left;
  };
  const parsed = sum();
  if (at !== src.length) throw new Error(`trailing text at ${at}: ${src.slice(at, at + 24)}`);
  return parsed;
}

/** The expression inside a `select='…'` filter. */
export function selectBody(filter: string): string {
  const body = /^select='(.*)'$/.exec(filter);
  if (!body?.[1]) throw new Error(`not a select: ${filter}`);
  return body[1];
}
