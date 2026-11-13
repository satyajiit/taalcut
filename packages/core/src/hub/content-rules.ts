// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a hub template may not say (docs/template-hub.md section 2): every string and every key NFC and free of
 * links, emails, handles, phone numbers, file paths, long encoded runs and data URIs; the document at most
 * HUB_MAX_BYTES and in shape (strict all the way down, so an unknown key anywhere is a `schema` problem). The rules
 * are data, exported to the hub repository's `content-rules.v0.json`, so its CI applies the very same patterns.
 * The app's share check and the Worker both run hubContentProblems, on the document as it serialises.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { HUB_ID_PATTERN } from './hub-parts';
import { HUB_MAX_BYTES, hubTemplateV0Schema } from './hub-template';

export const HUB_CONTENT_RULES = [
  { id: 'url', pattern: '[a-z][a-z0-9+.-]*://', flags: 'i' },
  { id: 'www', pattern: '\\bwww\\.', flags: 'i' },
  {
    id: 'domain',
    pattern:
      '\\b[a-z0-9-]+\\.(?:com|net|org|io|app|co|me|tv|in|ly|gg|xyz|link|site|info|biz|br|es|mx|ar|de|uk)\\b',
    flags: 'i',
  },
  { id: 'email', pattern: '[^\\s@]+@[^\\s@]+\\.[^\\s@]+', flags: '' },
  { id: 'handle', pattern: '(?:^|\\s)@[\\p{L}\\p{N}_.]{2,}', flags: 'u' },
  { id: 'phone', pattern: '(?:\\+?\\d[\\s().-]?){9,}', flags: '' },
  /** Where a file was on someone's machine: /Users/…/, ~/…/, ./…/, a drive letter or a network share. */
  {
    id: 'path',
    pattern: '(?:^|[\\s"\'(=])(?:~|\\.{1,2})?/[^\\s/]+/|\\b[A-Za-z]:\\\\|\\\\\\\\[^\\s\\\\]+\\\\',
    flags: '',
  },
  { id: 'encoded', pattern: '[A-Za-z0-9+/=_-]{40,}', flags: '' },
  { id: 'dataUri', pattern: 'data:[a-z]+/', flags: 'i' },
  { id: 'control', pattern: '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', flags: '' },
] as const;

/** A rule's id, or the document-level checks. */
export type HubContentRuleId = (typeof HUB_CONTENT_RULES)[number]['id'] | 'notNfc' | 'tooLarge' | 'schema';
export const HUB_DOCUMENT_RULES = ['notNfc', 'tooLarge', 'schema'] as const;

export const hubProblemSchema = z.object({
  /** JSON path, e.g. 'structure.slots.3.intent.text'; '' for the whole document. */
  path: z.string().max(200),
  rule: z.string().max(40),
});
export type HubProblem = z.output<typeof hubProblemSchema>;

/**
 * Fields that hold a ULID (HUB_ID_PATTERN) and nothing else: the prose rules don't run on them, since nine digits
 * in a row are a valid id, not a phone number. A value that isn't a ULID there is still checked (and a `schema`
 * problem).
 */
export const HUB_ID_PATHS = ['id', 'forkedFrom.id'] as const;

/** The most problems one check reports (a bad document can have thousands). */
export const MAX_HUB_PROBLEMS = 50;

const COMPILED = HUB_CONTENT_RULES.map((rule) => ({
  id: rule.id,
  regex: new RegExp(rule.pattern, rule.flags),
}));

/** UTF-8 bytes of a string. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Every string in a JSON value, keys included, with its path: nested and repeated objects alike. */
function* strings(value: unknown, path: readonly (string | number)[]): Generator<[string, string]> {
  if (typeof value === 'string') yield [path.join('.'), value];
  else if (Array.isArray(value))
    for (const [index, item] of value.entries()) yield* strings(item, [...path, index]);
  else if (typeof value === 'object' && value !== null)
    for (const [key, item] of Object.entries(value)) {
      yield [[...path, key].join('.'), key];
      yield* strings(item, [...path, key]);
    }
}

const isIdField = (path: string, text: string): boolean =>
  (HUB_ID_PATHS as readonly string[]).includes(path) && HUB_ID_PATTERN.test(text);

/** The document as it would be stored: its JSON, read back. Undefined when it has no JSON form (a cycle, a BigInt). */
function asStored(doc: unknown): { serialised: string; value: unknown } | undefined {
  try {
    const serialised = JSON.stringify(doc);
    return serialised === undefined ? undefined : { serialised, value: JSON.parse(serialised) };
  } catch {
    // Not JSON at all: one `schema` problem says so, nothing else can be checked.
    return undefined;
  }
}

/** Everything that keeps a document out of the hub, at most MAX_HUB_PROBLEMS; [] when it may be shared. */
export function hubContentProblems(doc: unknown): HubProblem[] {
  const stored = asStored(doc);
  if (!stored) return [{ path: '', rule: 'schema' }];
  const problems: HubProblem[] = [];
  if (utf8Bytes(stored.serialised) > HUB_MAX_BYTES) problems.push({ path: '', rule: 'tooLarge' });
  const parsed = hubTemplateV0Schema.safeParse(stored.value);
  if (!parsed.success)
    for (const issue of parsed.error.issues) problems.push({ path: issue.path.join('.'), rule: 'schema' });
  for (const [path, text] of strings(stored.value, [])) {
    if (text.normalize('NFC') !== text) problems.push({ path, rule: 'notNfc' });
    if (isIdField(path, text)) continue;
    for (const rule of COMPILED) if (rule.regex.test(text)) problems.push({ path, rule: rule.id });
  }
  return problems
    .slice(0, MAX_HUB_PROBLEMS)
    .map((problem) => ({ ...problem, path: problem.path.slice(0, 200) }));
}
