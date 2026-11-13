// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The content rules, applied exactly as the app's share check and the Worker apply them (`hubContentProblems` in
 * @taalcut/core): the document as it serialises, every string and every key at every depth, NFC, the rules from
 * schema/content-rules.v0.json except on id fields that hold an id, the size limit, at most `maxProblems`.
 * Shape is schema-check.mjs's job; a document with no JSON form is one `schema` problem here.
 */
import { readRepoJson } from './json-file.mjs';

const RULES = readRepoJson('schema', 'content-rules.v0.json');
const COMPILED = RULES.rules.map((rule) => ({ id: rule.id, regex: new RegExp(rule.pattern, rule.flags) }));
const ID_PATTERN = new RegExp(RULES.idPattern.pattern, RULES.idPattern.flags);
const ID_PATHS = new Set(RULES.idPaths);

export function contentProblems(doc) {
  const stored = asStored(doc);
  if (!stored) return [{ jsonPath: '', rule: 'schema' }];
  const problems = [];
  if (Buffer.byteLength(stored.serialised, 'utf8') > RULES.maxBytes) problems.push({ jsonPath: '', rule: 'tooLarge' });
  for (const [jsonPath, text] of strings(stored.value, [])) {
    if (text.normalize('NFC') !== text) problems.push({ jsonPath, rule: 'notNfc' });
    if (ID_PATHS.has(jsonPath) && ID_PATTERN.test(text)) continue;
    for (const rule of COMPILED) if (rule.regex.test(text)) problems.push({ jsonPath, rule: rule.id });
  }
  return problems
    .slice(0, RULES.maxProblems)
    .map((problem) => ({ ...problem, jsonPath: problem.jsonPath.slice(0, RULES.maxPathLength) }));
}

/** The document as it would be stored: its JSON, read back. Null when it has no JSON form. */
function asStored(doc) {
  let serialised;
  try {
    serialised = JSON.stringify(doc);
  } catch {
    // A cycle or a BigInt: the caller reports one `schema` problem, as core does.
    return null;
  }
  return serialised === undefined ? null : { serialised, value: JSON.parse(serialised) };
}

/** Every string in a JSON value, keys included, with its dotted path. */
function* strings(value, path) {
  if (typeof value === 'string') yield [path.join('.'), value];
  else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* strings(item, [...path, index]);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      yield [[...path, key].join('.'), key];
      yield* strings(item, [...path, key]);
    }
  }
}
