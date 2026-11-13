// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { binaryExtension, hasBom, hasMagic } from './lib/binary-check.mjs';
import { runIfDirect, stop } from './lib/cli.mjs';
import { contentProblems } from './lib/content-check.mjs';
import { formatProblem, MAX_PRINTED_PROBLEMS } from './lib/problems.mjs';
import { asRelative, expectedTemplatePath, isTemplateJson, listTemplateJson, packageRoot, readChangedList } from './lib/read-changes.mjs';
import { schemaProblems } from './lib/schema-check.mjs';
import { tooLarge } from './lib/size-check.mjs';
import { structureProblems, versionProblem } from './lib/structure-check.mjs';

/** @param {string[]} argv */
export function main(argv) {
  const args = parseArgs(argv);
  const root = path.resolve(args.root ?? packageRoot());
  const found = [];
  if (args.changedList) collectChanges(root, args, found);
  else if (args.files.length > 0) collectFiles(root, args, found);
  else collectTree(root, args, found);
  const printed = found.slice(0, MAX_PRINTED_PROBLEMS).map((item) => formatProblem(item.rel, item.problem));
  if (printed.length > 0) stop(...printed);
}

function collectChanges(root, args, found) {
  for (const line of readChangedList(args.changedList)) {
    const rel = asRelative(root, line);
    if (binaryExtension(rel)) {
      add(found, rel, [{ rule: 'binary' }]);
      continue;
    }
    if (!isTemplateJson(rel)) {
      add(found, rel, [{ rule: 'scope' }]);
      continue;
    }
    const absolute = path.join(root, rel);
    if (!existsSync(absolute)) {
      add(found, rel, [{ rule: 'deleted' }]);
      continue;
    }
    add(found, rel, inspect(root, rel, readFileSync(absolute), args));
  }
}

function collectFiles(root, args, found) {
  for (const file of args.files) {
    const absolute = path.isAbsolute(file) ? file : path.join(root, file);
    const rel = asRelative(root, absolute);
    if (!existsSync(absolute)) {
      add(found, rel, [{ rule: 'deleted' }]);
      continue;
    }
    add(found, rel, inspect(root, rel, readFileSync(absolute), args));
  }
}

function collectTree(root, args, found) {
  for (const absolute of listTemplateJson(root)) {
    const rel = asRelative(root, absolute);
    add(found, rel, inspect(root, rel, readFileSync(absolute), args));
  }
}

function inspect(root, rel, bytes, args) {
  if (binaryExtension(rel)) return [{ rule: 'binary' }];
  if (tooLarge(bytes.length)) return [{ rule: 'tooLarge' }];
  if (hasMagic(bytes)) return [{ rule: 'binary' }];
  if (hasBom(bytes)) return [{ rule: 'bom' }];
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return [{ rule: 'schema' }];
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return [{ rule: 'schema' }];
  }
  const problems = [];
  const id = doc && typeof doc === 'object' ? doc.id : undefined;
  if (typeof id !== 'string' || expectedTemplatePath(id) !== rel) problems.push({ rule: 'path' });
  problems.push(...schemaProblems(doc));
  problems.push(...contentProblems(doc));
  const schemaFailed = problems.some((problem) => problem.rule === 'schema');
  if (!schemaFailed) problems.push(...structureProblems(doc));
  if (args.previous || args.base) {
    const previous = args.previous ? JSON.parse(readFileSync(args.previous, 'utf8')) : previousFromGit(root, args.base, rel);
    const version = versionProblem(doc, previous);
    if (version) problems.push(version);
  }
  return dedupe(problems);
}

function previousFromGit(root, base, rel) {
  try {
    const text = execFileSync('git', ['show', `${base}:${rel}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function dedupe(problems) {
  const seen = new Set();
  const out = [];
  for (const problem of problems) {
    const key = `${problem.jsonPath ?? ''}\0${problem.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(problem);
  }
  return out;
}

function add(found, rel, problems) {
  for (const problem of problems) found.push({ rel, problem });
}

function parseArgs(argv) {
  const args = { files: [], changedList: null, root: null, base: null, previous: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--files') {
      while (argv[index + 1] && !argv[index + 1].startsWith('--')) {
        index += 1;
        args.files.push(argv[index]);
      }
    } else if (arg === '--changed-list') args.changedList = take(argv, (index += 1));
    else if (arg === '--root') args.root = take(argv, (index += 1));
    else if (arg === '--base') args.base = take(argv, (index += 1));
    else if (arg === '--previous') args.previous = take(argv, (index += 1));
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
