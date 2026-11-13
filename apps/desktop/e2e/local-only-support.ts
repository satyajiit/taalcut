// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the Local only journey (make-flow-local-only.e2e.ts, P3-B10) needs around the make flow's world:
 * Local only on and the Local only profile written into the library before the app opens it, the test
 * build's switches for the on-device stand-in and the network recorder, and the recorder's per-process logs
 * read back.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_ONLY_SETTING, unwrap } from '@taalcut/core';
import { createModelProfileStore, createRepositories, openDatabase, sqliteVecPath } from '@taalcut/library';
import { defaultProfileState } from '@taalcut/models';
import { libraryPath } from '../src/shared/library-path';
import { makeFlowEnv } from './make-flow-support';

/** Settings → Privacy → Local only, and the Local only profile, as a person would have set them. */
export async function seedLocalOnly(userData: string): Promise<void> {
  const opened = openDatabase({ path: libraryPath(userData), extensions: [sqliteVecPath()] });
  if (!opened.ok) throw new Error(`library not opened: ${opened.error.code}`);
  const db = opened.value;
  try {
    unwrap(createRepositories(db).settings.set(LOCAL_ONLY_SETTING.key, true));
    unwrap(await createModelProfileStore(db).save(defaultProfileState('local-only')));
  } finally {
    db.close();
  }
}

/**
 * The make flow's stand-ins (embeddings, analysers, the headless shell) without its recorded cloud session:
 * the agent keeps the production ModelClient and its on-device turns come from the loopback stand-in. Every
 * process records its network attempts into `network`, refusing all but loopback.
 */
export function localOnlyEnv(home: string, folders: { readonly network: string; readonly session: string }) {
  const { TAALCUT_TEST_RECORDED_MODELS: _recorded, ...env } = makeFlowEnv(home);
  return {
    ...env,
    TAALCUT_TEST_LOCAL_SESSION: folders.session,
    TAALCUT_TEST_NETWORK_LOG: folders.network,
  };
}

/** The on-device runtime started (the hardware probe told it the tier): what it serves. */
export function runtimeStarted(session: string): { tier: string; models: string[] } | undefined {
  const file = join(session, 'runtime.json');
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as { tier: string; models: string[] })
    : undefined;
}

/** The model requests the stand-in answered, in order. */
export function servedTurns(session: string): { model: string; kind: string; ask: string }[] {
  const file = join(session, 'turns.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { model: string; kind: string; ask: string });
}

export interface NetworkLogs {
  /** Processes whose recorder reported it was installed. */
  readonly installed: readonly string[];
  /** Every attempt, every process. */
  readonly attempts: readonly {
    process: string;
    api: string;
    host: string;
    port: number | null;
    allowed: boolean;
    stack: string;
  }[];
}

/** Every process's log in the folder. */
export function readNetworkLogs(dir: string): NetworkLogs {
  const installed: string[] = [];
  const attempts: NetworkLogs['attempts'][number][] = [];
  if (!existsSync(dir)) return { installed, attempts };
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as { kind: string; process: string } & NetworkLogs['attempts'][number];
      if (entry.kind === 'installed') installed.push(entry.process);
      else attempts.push(entry);
    }
  }
  return { installed: [...new Set(installed)].sort(), attempts };
}
