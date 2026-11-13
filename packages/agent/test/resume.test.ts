// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-G2 "Done when", part 1: a scripted run killed mid-way (SIGKILL, in a
 * real child process) resumes in a new process and finishes, with every
 * command applied exactly once and a gapless log.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { createAgent, createFileEventLogStore, createScriptedModelClient } from '@taalcut/agent';
import { createToolRegistry } from '@taalcut/tools';
import { afterEach, describe, expect, it } from 'vitest';
import { crashScript, fileCommands, readApplied } from './support/crash-script';
import { clipsModule } from './support/fixtures';
import { ofType, SOUL, types } from './support/harness';

const CHILD = join(import.meta.dirname, 'support', 'crash-child.ts');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runChild(dir: string, mode: string): Promise<NodeJS.Signals | number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD, dir, mode], {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      signal
        ? resolve(signal)
        : code === 0
          ? resolve(0)
          : reject(new Error(`child exited ${code}: ${stderr}`)),
    );
  });
}

function restartedAgent(dir: string) {
  const store = createFileEventLogStore(join(dir, 'log'));
  const agent = createAgent({
    models: createScriptedModelClient(crashScript),
    tools: unwrap(createToolRegistry([clipsModule()])),
    log: store,
    soul: SOUL,
    commands: fileCommands(join(dir, 'commands.jsonl')),
    settings: { autonomy: 'autopilot', budget: {} },
  });
  return { agent, store };
}

describe.each(['after-log', 'after-commit'])('killed with SIGKILL %s', (mode) => {
  it(
    'resumes in a new process, finishes, and applies every command exactly once',
    { timeout: 30_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'taalcut-crash-'));
      dirs.push(dir);
      expect(await runChild(dir, mode)).toBe('SIGKILL');

      const before = readApplied(join(dir, 'commands.jsonl')).map((c) => c.key);
      expect(before).toEqual(
        mode === 'after-log'
          ? [expect.stringMatching(/:clips\.renameClip:c1:One$/)]
          : [expect.stringMatching(/c1:One$/), expect.stringMatching(/c2:Two$/)],
      );

      const { agent, store } = restartedAgent(dir);
      const [runId, ...others] = unwrap(await agent.recoverInterrupted());
      expect(others).toEqual([]);
      const outcome = unwrap(await agent.wait(runId!));
      expect(outcome).toMatchObject({
        status: 'completed',
        report: 'Renamed both clips; the text has 3 words.',
      });

      const applied = readApplied(join(dir, 'commands.jsonl'));
      expect(applied.map((c) => c.payload)).toEqual([
        { id: 'c1', title: 'One' },
        { id: 'c2', title: 'Two' },
      ]);
      const events = unwrap(await store.read(runId!));
      expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
      expect(ofType(events, 'run.resumed').map((e) => e.payload.after)).toEqual(['crash']);
      // The turn that asked for c2 was logged once and not asked again: its calls were re-run under the same ids.
      expect(
        ofType(events, 'tool.requested').filter((e) => JSON.stringify(e.payload.input).includes('c2')),
      ).toHaveLength(1);
      expect(types(events).at(-1)).toBe('run.completed');
      expect(unwrap(await store.openRuns())).toEqual([]);

      // P1-G2 "Done when", part 2: replay of the resumed run reproduces the same tool sequence.
      const replay = unwrap(await agent.replay(runId!));
      expect(replay.toolCalls).toEqual([
        { tool: 'clips.renameClip', input: '{"id":"c1","title":"One"}' },
        { tool: 'clips.countWords', input: '{"text":"a b c"}' },
        { tool: 'clips.renameClip', input: '{"id":"c2","title":"Two"}' },
      ]);
      expect(replay.status).toBe('completed');
      expect(readApplied(join(dir, 'commands.jsonl'))).toHaveLength(2);
    },
  );
});
