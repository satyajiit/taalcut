// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds site/v0 for GitHub Pages: index.json and a byte-for-byte copy of every template not in
 * moderation/hidden.json. A template that fails the pull request checks, or an index the app's
 * `hubIndexSchema` would refuse, stops the build: nothing is published rather than something broken.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runIfDirect, stop } from './lib/cli.mjs';
import { contentProblems } from './lib/content-check.mjs';
import { hiddenIds, readHidden } from './lib/hidden-list.mjs';
import { indexEntry } from './lib/index-entry.mjs';
import { writeJsonFile } from './lib/json-file.mjs';
import { formatProblem, MAX_PRINTED_PROBLEMS } from './lib/problems.mjs';
import { asRelative, listTemplateJson, packageRoot } from './lib/read-changes.mjs';
import { indexProblems, schemaProblems } from './lib/schema-check.mjs';
import { structureProblems } from './lib/structure-check.mjs';

/** @param {string[]} argv */
export function main(argv) {
  const args = parseArgs(argv);
  const root = path.resolve(args.root ?? packageRoot());
  const now = args.now === undefined ? Date.now() : parseNow(args.now);
  const out = path.resolve(args.out ?? path.join(root, 'site'));
  const hidden = hiddenIds(readHidden(path.join(root, 'moderation', 'hidden.json')));
  rmSync(path.join(out, 'v0'), { recursive: true, force: true });
  const entries = [];
  for (const absolute of listTemplateJson(root)) {
    const rel = asRelative(root, absolute);
    const raw = readFileSync(absolute);
    const doc = parseDocument(rel, raw);
    if (hidden.has(doc.id)) continue;
    entries.push(indexEntry(doc, raw, rel, root, now));
    const copy = path.join(out, 'v0', 'templates', `${doc.id}.json`);
    mkdirSync(path.dirname(copy), { recursive: true });
    writeFileSync(copy, raw);
  }
  entries.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
  const index = { formatVersion: 0, generatedAt: now, templates: entries };
  refuse('site/v0/index.json', indexProblems(index));
  writeJsonFile(path.join(out, 'v0', 'index.json'), index);
}

function parseDocument(rel, raw) {
  let doc;
  try {
    doc = JSON.parse(raw.toString('utf8'));
  } catch {
    refuse(rel, [{ rule: 'schema' }]);
  }
  const shape = schemaProblems(doc);
  refuse(rel, [...shape, ...contentProblems(doc), ...(shape.length === 0 ? structureProblems(doc) : [])]);
  return doc;
}

function refuse(rel, problems) {
  const printed = problems.slice(0, MAX_PRINTED_PROBLEMS).map((problem) => formatProblem(rel, problem));
  if (printed.length > 0) stop(...printed);
}

function parseNow(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) stop('bad --now');
  return parsed;
}

function parseArgs(argv) {
  const args = { root: null, now: undefined, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') args.root = take(argv, (index += 1));
    else if (arg === '--now') args.now = take(argv, (index += 1));
    else if (arg === '--out') args.out = take(argv, (index += 1));
    else stop(`unknown argument ${arg}`);
  }
  return args;
}

function take(argv, index) {
  const value = argv[index];
  if (!value) stop('missing argument value');
  return value;
}

runIfDirect(import.meta.url, main);
