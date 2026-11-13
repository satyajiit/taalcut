// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every error code the backend can send has English the window can show (FIX-ERRWORDS). The window says an error in
 * the words it has for `errors.<code>` (the kit's errorMessage: its ERROR_MESSAGES, then the catalogue, which holds
 * the renderer's KEYED_MESSAGES and feature catalogues too); a code without them reads "Something went wrong. Try
 * again, and if it keeps happening, restart Taalcut." models.provider_error and agent.turn_limit did, in a chat.
 *
 * Every utility root is composed and main's modules that define errors are loaded (main's own composition needs
 * Electron), so core's registry holds every code a process defines. The kit's tables and KEYED_MESSAGES use explicit
 * ids `errors.<code>`, which extract writes to the renderer's English catalogue (the kit's test checks each table key
 * is its id), so that catalogue is what this reads: apps/desktop may not import the kit or the renderer.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definedErrorCodes } from '@taalcut/core';
import { composeLan } from '../src/utility/roots/lan-root';
import { composeMcp } from '../src/utility/roots/mcp-root';
import { composeRender } from '../src/utility/roots/render-root';
import type { UtilityRoot } from '../src/utility/runtime';
import { testAgent, testConfig, testJobs } from './helpers/roots';

const repo = join(import.meta.dirname, '..', '..', '..');

/** Codes no window ever receives, and why. A code here that gains words, or is no longer defined, fails. */
const NEVER_SHOWN: Readonly<Record<string, string>> = {
  'agent.soul_invalid':
    'the bundled SOUL.md is read when the agent process is composed; a bad one throws there (agent-soul.ts)',
  'agent.skill_invalid':
    'skill modules are checked when the agent process is composed; a bad one is logged and left out (agent-flows.ts)',
  'agent.flow_extension_invalid':
    'flow extensions are checked when the agent process is composed; bad ones are logged and left out (agent-gaps.ts)',
  'tools.registration_failed':
    'tool modules are checked when the agent process is composed; a bad one throws there (agent-loop.ts)',
  'agent.tone_recording_invalid':
    'only the tone evals read tone recordings (agent/src/evals, soul/tone-set.ts)',
  'agent.replay_diverged':
    'only replayRun raises it, and nothing in the app replays a run (tests and evals do)',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

/** msgid → msgstr of the window's English catalogue. */
function catalogue(): Map<string, string> {
  const po = readFileSync(join(repo, 'apps', 'renderer', 'src', 'locales', 'en', 'messages.po'), 'utf8');
  const entries = new Map<string, string>();
  for (const [, id, text] of po.matchAll(/^msgid "(.*)"\nmsgstr "(.*)"$/gm)) entries.set(id!, text!);
  return entries;
}

const roots: UtilityRoot[] = [];
let codes: string[] = [];

// Composing render and the agent opens a database with every migration: well over Vitest's 5 s while the suite runs.
beforeAll(async () => {
  roots.push(testAgent(testConfig('agent')));
  roots.push(testJobs(testConfig('jobs')));
  roots.push(await composeRender(testConfig('render'), 21));
  roots.push(composeLan(testConfig('lan'), 22));
  roots.push(composeMcp(testConfig('mcp'), new MessageChannel().port1, 23));
  for (const file of sources(join(repo, 'apps', 'desktop', 'src', 'main')))
    if (readFileSync(file, 'utf8').includes('defineError')) await import(file);
  codes = definedErrorCodes();
}, 60_000);
afterAll(async () => {
  for (const root of roots.splice(0)) await root.container.dispose();
});

describe('error words', () => {
  it('cover every error each process defines', () => {
    // One code from each process and package the window hears from, so a root that stops loading shows up here.
    expect(codes).toEqual(
      expect.arrayContaining([
        'models.provider_error',
        'agent.turn_limit',
        'jobs.handler_failed',
        'render.batch_too_large',
        'transfer.device_gone',
        'mcp.rate_limited',
        'desktop.update_check_failed',
        'desktop.mcp_token_missing',
      ]),
    );
    const words = catalogue();
    const missing = codes.filter((code) => !(code in NEVER_SHOWN) && !words.get(`errors.${code}`));
    expect(missing).toEqual([]);
  });

  it('leave out only codes that are still defined and still have no words', () => {
    const words = catalogue();
    for (const code of Object.keys(NEVER_SHOWN)) {
      expect(codes, code).toContain(code);
      expect(words.get(`errors.${code}`), code).toBeUndefined();
    }
  });
});
