// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { runIfDirect, stop } from './lib/cli.mjs';
import { applyHidden, readHidden } from './lib/hidden-list.mjs';
import { readRepoJson, writeJsonFile } from './lib/json-file.mjs';
import { packageRoot } from './lib/read-changes.mjs';

const { idPattern } = readRepoJson('schema', 'content-rules.v0.json');
const ULID = new RegExp(idPattern.pattern, idPattern.flags);

/** @param {string[]} argv */
export function main(argv) {
  const args = parseArgs(argv);
  const root = path.resolve(args.root ?? packageRoot());
  const hiddenFile = path.resolve(args.hidden ?? path.join(root, 'moderation', 'hidden.json'));
  const command = args.event ? fromPayload(JSON.parse(readFileSync(args.event, 'utf8')), args.eventName) : fromFlags(args);
  if (command.skip) return;
  if (command.error) stop(command.error);
  if (command.action !== 'hide' && command.action !== 'restore') stop('action');
  if (typeof command.hubId !== 'string' || !ULID.test(command.hubId)) stop('hub id');
  if (!Number.isSafeInteger(command.issue) || command.issue < 0) stop('issue');
  writeJsonFile(hiddenFile, applyHidden(readHidden(hiddenFile), command));
}

function fromFlags(args) {
  return {
    action: args.action,
    hubId: args.hubId,
    reason: args.reason ?? 'maintainer',
    issue: args.issue ?? 0,
    at: args.at ?? new Date().toISOString(),
  };
}

function fromPayload(payload, eventName) {
  if (!payload || typeof payload !== 'object') return { error: 'unrecognised event' };
  if (eventName === 'workflow_dispatch' || (payload.inputs && typeof payload.inputs.hubId === 'string')) {
    const inputs = payload.inputs ?? {};
    return {
      action: inputs.action,
      hubId: inputs.hubId,
      reason: typeof inputs.reason === 'string' && inputs.reason ? inputs.reason : 'maintainer',
      issue: issueNumber(inputs.issue),
      at: new Date().toISOString(),
    };
  }
  if (payload.issue && typeof payload.issue === 'object') return fromIssue(payload);
  if (typeof payload.hubId === 'string' && (payload.action === 'hide' || payload.action === 'restore')) {
    return {
      action: payload.action,
      hubId: payload.hubId,
      reason: typeof payload.reason === 'string' && payload.reason ? payload.reason : 'maintainer',
      issue: typeof payload.issue === 'number' ? payload.issue : 0,
      at: typeof payload.at === 'string' ? payload.at : new Date().toISOString(),
    };
  }
  return { error: 'unrecognised event' };
}

/** A workflow input is text: blank is no issue, digits are its number, anything else is refused (NaN). */
function issueNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  return /^\d+$/.test(String(value)) ? Number(value) : Number.NaN;
}

function fromIssue(payload) {
  const labelName = payload.label && typeof payload.label.name === 'string' ? payload.label.name : '';
  if (labelName && labelName !== 'hidden') return { skip: true };
  const labels = Array.isArray(payload.issue.labels) ? payload.issue.labels : [];
  const hub = labels
    .map((label) => (label && typeof label.name === 'string' ? label.name : ''))
    .find((name) => name.startsWith('hub:'));
  if (!hub) return { error: 'missing hub label' };
  const action = payload.action === 'unlabeled' ? 'restore' : payload.action === 'labeled' ? 'hide' : null;
  if (!action) return { error: 'unsupported issue action' };
  return {
    action,
    hubId: hub.slice('hub:'.length),
    reason: 'maintainer',
    issue: Number(payload.issue.number),
    at: typeof payload.issue.updated_at === 'string' ? payload.issue.updated_at : new Date().toISOString(),
  };
}

function parseArgs(argv) {
  const args = {
    root: null,
    hidden: null,
    action: null,
    hubId: null,
    reason: null,
    issue: null,
    at: null,
    event: null,
    eventName: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') args.root = take(argv, (index += 1));
    else if (arg === '--hidden') args.hidden = take(argv, (index += 1));
    else if (arg === '--action') args.action = take(argv, (index += 1));
    else if (arg === '--hub-id') args.hubId = take(argv, (index += 1));
    else if (arg === '--reason') args.reason = take(argv, (index += 1));
    else if (arg === '--issue') args.issue = issueNumber(take(argv, (index += 1)));
    else if (arg === '--at') args.at = take(argv, (index += 1));
    else if (arg === '--event' || arg === '--github-event') args.event = take(argv, (index += 1));
    else if (arg === '--event-name') args.eventName = take(argv, (index += 1));
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
