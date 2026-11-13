// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1: a refused call's input, with a corrected example built from the model's own call. A local model told only
 * "✖ Invalid string: must match pattern … → at templateId" sent the same call again; shown its call with each
 * refused field mended (a string cut to its length, an option spelled as the schema spells it, a placeholder that
 * says what goes in a missing or malformed field), it can copy the fix. The example is a guide, never sent anywhere.
 */
import { z } from 'zod';

/** Examples longer than this are listed field by field instead. */
const EXAMPLE_CHARS = 1_500;

type Path = readonly PropertyKey[];

const clone = (value: unknown): unknown =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function setAt(root: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const container: Record<PropertyKey, unknown> | unknown[] =
    root !== null && typeof root === 'object' ? (root as never) : typeof head === 'number' ? [] : {};
  (container as Record<PropertyKey, unknown>)[head as never] = setAt(
    (container as Record<PropertyKey, unknown>)[head as never],
    rest,
    value,
  );
  return container;
}

function getAt(root: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === 'object' ? (value as never)[key as never] : undefined,
    root,
  );
}

const cutAtWord = (text: string, limit: number) => {
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return space > limit / 2 ? cut.slice(0, space) : cut;
};

const pathText = (path: Path) =>
  path
    .map((key, index) =>
      typeof key === 'number' ? `[${key}]` : index === 0 ? String(key) : `.${String(key)}`,
    )
    .join('');

/** What one issue's field becomes in the example; undefined when there is nothing better to show. */
function mended(issue: z.core.$ZodIssue, value: unknown): unknown {
  switch (issue.code) {
    case 'too_big':
      if (typeof value === 'string' && issue.origin === 'string')
        return cutAtWord(value, Number(issue.maximum));
      if (Array.isArray(value) && issue.origin === 'array') return value.slice(0, Number(issue.maximum));
      if (typeof value === 'number') return issue.maximum;
      return undefined;
    case 'too_small':
      if (typeof value === 'number') return issue.minimum;
      if (issue.origin === 'string') return `<at least ${String(issue.minimum)} characters>`;
      if (issue.origin === 'array')
        return Array.isArray(value) && value.length > 0 ? value : ['<one item at least>'];
      return undefined;
    case 'invalid_value': {
      const options = issue.values.map(String);
      const near =
        typeof value === 'string'
          ? options.find((o) => o.toLowerCase() === value.trim().toLowerCase())
          : undefined;
      return near ?? `<one of ${options.join(', ')}>`;
    }
    case 'invalid_type':
      if (issue.expected === 'number' && typeof value === 'string' && Number.isFinite(Number(value)))
        return Number(value);
      if ((issue.expected === 'array' || issue.expected === 'object') && typeof value === 'string')
        return `<the JSON ${issue.expected} itself, not a string holding it>`;
      if (value === undefined || value === null) return `<${issue.expected}: required>`;
      return `<${issue.expected}>`;
    case 'invalid_format':
      return issue.format === 'regex' ? '<the id or value a tool returned>' : `<a valid ${issue.format}>`;
    default:
      return undefined;
  }
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** Passes over an input whose JSON strings hold JSON strings ("[\"{…}\"]"). */
const UNWRAP_PASSES = 3;

/**
 * AGT1: an array or object sent as a JSON string, where the schema wants the array or object. MLX1's 9B sent
 * setIntents' `intents` as "[{\"slotIndex\": 0, …}]" 25 times on the owner's reel and was refused each time; the
 * call is accepted as if it had sent the array. A string that doesn't parse, or parses to the wrong kind, is refused
 * as before. An empty string a field may not be is left out, which passes only when the field is optional.
 */
export function parseToolInput<T>(schema: z.ZodType<T>, input: unknown): z.ZodSafeParseResult<T> {
  const first = schema.safeParse(input);
  let result = first;
  let current = input;
  for (let pass = 0; pass < UNWRAP_PASSES && !result.success; pass++) {
    const unwrapped = unwrapJsonStrings(current, result.error);
    if (unwrapped === undefined) break;
    current = unwrapped;
    result = schema.safeParse(current);
  }
  return result.success ? result : first;
}

function withoutAt(root: unknown, path: Path): unknown {
  const parent = getAt(root, path.slice(0, -1));
  if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) return undefined;
  delete (parent as Record<PropertyKey, unknown>)[path.at(-1) as never];
  return root;
}

function unwrapJsonStrings(input: unknown, error: z.ZodError): unknown {
  let fixed = clone(input);
  let changed = false;
  for (const issue of error.issues) {
    // An empty string where one character is the least (MLX1's and AGT1's 9B sent `"reel": ""` for "no reel words"):
    // the field left out. A required field is refused again on the next pass, as before.
    if (issue.code === 'too_small' && issue.origin === 'string' && getAt(fixed, issue.path) === '') {
      const without = issue.path.length > 0 ? withoutAt(fixed, issue.path) : undefined;
      if (without !== undefined) {
        fixed = without;
        changed = true;
      }
      continue;
    }
    if (issue.code !== 'invalid_type' || issue.path.length === 0) continue;
    if (issue.expected !== 'array' && issue.expected !== 'object') continue;
    const value = getAt(fixed, issue.path);
    if (typeof value !== 'string') continue;
    const parsed = parseJson(value);
    const fits =
      issue.expected === 'array'
        ? Array.isArray(parsed)
        : parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    if (!fits) continue;
    fixed = setAt(fixed, issue.path, parsed);
    changed = true;
  }
  return changed ? fixed : undefined;
}

/** The model's input with each refused field mended, or undefined when no issue names a field it can mend. */
export function correctedExample(input: unknown, error: z.ZodError): unknown {
  let example = clone(input);
  let changed = false;
  for (const issue of error.issues) {
    const value = getAt(example, issue.path);
    const fixed = mended(issue, value);
    if (fixed === undefined || issue.path.length === 0) continue;
    example = setAt(example, issue.path, fixed);
    changed = true;
  }
  return changed ? example : undefined;
}

/** The refusal's detail: zod's issues, then the call that fits (or, for a long one, its mended fields). */
export function invalidInputDetail(input: unknown, error: z.ZodError): string {
  const issues = z.prettifyError(error);
  const example = correctedExample(input, error);
  if (example === undefined) return issues;
  const json = JSON.stringify(example);
  if (json.length <= EXAMPLE_CHARS) return `${issues}\nYour call with those fields mended: ${json}`;
  const fields = error.issues
    .filter((issue) => issue.path.length > 0)
    .map((issue) => `${pathText(issue.path)}: ${JSON.stringify(getAt(example, issue.path))}`.slice(0, 200));
  return `${issues}\nMend these fields of your call and send it again: ${fields.join('; ')}`;
}
