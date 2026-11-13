// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-I2: EAR1's tools over MCP, through the agent root's gateway (agent-mcp.ts) on the registry the app builds,
 * with the audio module joined by agent-audio.ts' `withAudioTools` (the listening tools of agent-listen-qa.ts and
 * agent-listen-search.ts, and agent-listen-cloud.ts' upload). A read session lists the five local listening tools
 * and `music.findLibraryTrack` 1.1, read-only and closed-world; `sfx.addHits` 2.0 is listed and run from the edit
 * level only; `audio.cloudCritique` (it uploads the person's sound, `exposure.mcp: false`) is neither listed nor
 * callable at any level. Schemas still change (EAR1-G1), so this checks names, levels and annotations only.
 */
import {
  newId,
  ok,
  type Container,
  type McpCallItem,
  type McpLevel,
  type McpSessionId,
  type McpToolDef,
} from '@taalcut/core';
import { levelNeeded, tokenHash, type ExternalRunner, type ToolRegistry } from '@taalcut/tools';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ExternalRunnerToken, ToolRegistryToken } from '../src/shared/tokens';
import { McpGatewayToken } from '../src/utility/roots/agent-mcp';
import { testAgent, testConfig } from './helpers/roots';

/** EAR1's five new tools: local, read-only, offered to a read session. */
const LISTENING = ['audio.listen', 'audio.findMoment', 'audio.compare', 'audio.critique', 'sfx.searchSounds'];
/** Read tools EAR1 changed: `describe` (genre and mood come back as hints). */
const CHANGED_READ = ['music.findLibraryTrack'];
const callName = (name: string) => name.replace('.', '_');

interface RunnerCall {
  readonly name: string;
  readonly level: McpLevel;
}

let container: Container;
let registry: ToolRegistry;
const calls: RunnerCall[] = [];
const sessions = new Map<McpLevel, McpSessionId>();

const runner: ExternalRunner = {
  open: async () => ok({ runId: newId<'AgentRun'>(), conversationId: newId<'Conversation'>() }),
  call: async (_runId, name, _input, options) => {
    calls.push({ name, level: options.level });
    return ok({ kind: 'declined' });
  },
  close: async () => ok(undefined),
};

const gateway = () => container.resolve(McpGatewayToken);

function listed(level: McpLevel): Map<string, McpToolDef> {
  const answer = gateway().listTools(sessions.get(level)!);
  if (!answer.ok) throw new Error(answer.error.code);
  return new Map(answer.value.tools.map((tool) => [tool.name, tool]));
}

async function callAs(level: McpLevel, name: string): Promise<McpCallItem[]> {
  const items: McpCallItem[] = [];
  const stream = gateway().call({
    sessionId: sessions.get(level)!,
    callKey: newId(),
    name,
    arguments: {},
    wantsProgress: false,
  });
  for await (const item of stream) items.push(item);
  return items;
}

beforeAll(async () => {
  ({ container } = testAgent(testConfig('agent')));
  // The session's calls reach this runner instead of the agent's (the gateway looks it up on each use).
  container.value(ExternalRunnerToken, runner);
  registry = container.resolve(ToolRegistryToken);
  const started = await gateway().start();
  if (!started.ok) throw new Error(started.error.code);
  for (const [level, char] of [
    ['read', 'r'],
    ['edit', 'd'],
    ['export', 'x'],
  ] as const) {
    const sessionId = newId<'McpSession'>();
    const added = await gateway().sessionWrites.add({
      sessionId,
      name: `Agent ${level}`,
      client: 'other',
      level,
      tokenHash: tokenHash(`tcm_${char.repeat(43)}`),
    });
    if (!added.ok) throw new Error(added.error.code);
    sessions.set(level, sessionId);
  }
}, 60_000);

afterAll(async () => {
  await container?.dispose();
});

beforeEach(() => {
  calls.length = 0;
});

describe("EAR1's listening tools over MCP", () => {
  it('lists the five listening tools and music.findLibraryTrack 1.1 to a read session, read-only and local', () => {
    expect(registry.describe('music.findLibraryTrack')?.version).toBe('1.1.0');
    const read = listed('read');
    for (const name of [...LISTENING, ...CHANGED_READ]) {
      const descriptor = registry.describe(name);
      expect(descriptor, name).toMatchObject({
        costClass: 'local',
        sideEffect: 'read',
        exposure: { mcp: true },
      });
      const def = read.get(callName(name));
      expect(def, `${name} on a read session`).toBeDefined();
      expect(def?.annotations, name).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      // MCP requires an object at the input schema's root.
      expect(def?.inputSchema['type'], name).toBe('object');
      expect(def?.description, name).not.toContain('Needs your approval');
    }
  });

  it('runs a listening tool for a read session through the runner', async () => {
    const items = await callAs('read', 'audio_listen');
    expect(calls).toEqual([{ name: 'audio.listen', level: 'read' }]);
    expect(items.at(-1)).toMatchObject({ type: 'result', isError: true });
  });

  it('tells an external client that genre and mood are hints, in one-line titles', () => {
    const read = listed('read');
    for (const name of [...LISTENING, ...CHANGED_READ]) {
      const title = read.get(callName(name))?.title ?? '';
      expect(title, name).not.toBe('');
      expect(title, name).not.toContain('\n');
    }
    for (const name of ['audio.findMoment', 'sfx.searchSounds', 'music.findLibraryTrack'])
      expect(read.get(callName(name))?.description, name).toMatch(/\bhints?\b/);
    expect(read.get('audio_listen')?.title).toMatch(/\bhints?\b/);
  });
});

describe('sfx.addHits 2.0 over MCP', () => {
  it('needs the edit level', () => {
    const descriptor = registry.describe('sfx.addHits');
    expect(descriptor?.version).toMatch(/^2\./);
    expect(descriptor && levelNeeded(descriptor)).toBe('edit');
    expect(listed('read').has('sfx_addHits')).toBe(false);
    for (const level of ['edit', 'export'] as const)
      expect(listed(level).get('sfx_addHits')?.annotations, level).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });
  });

  it('refuses a read session and runs for an edit session', async () => {
    const refused = await callAs('read', 'sfx_addHits');
    expect(refused).toEqual([
      expect.objectContaining({
        type: 'result',
        isError: true,
        structuredContent: { error: expect.objectContaining({ code: 'mcp.level_too_low' }) },
      }),
    ]);
    expect(calls).toEqual([]);
    await callAs('edit', 'sfx_addHits');
    expect(calls).toEqual([{ name: 'sfx.addHits', level: 'edit' }]);
  });
});

describe('audio.cloudCritique over MCP', () => {
  it('is in the registry, yet listed at no level', () => {
    expect(registry.describe('audio.cloudCritique')).toMatchObject({
      sideEffect: 'external',
      costClass: 'cloud',
      exposure: { mcp: false },
    });
    for (const level of ['read', 'edit', 'export'] as const) {
      const tools = listed(level);
      expect(tools.has('audio_cloudCritique'), level).toBe(false);
      // The rest of the audio module is still offered.
      expect(tools.has('audio_listen'), level).toBe(true);
    }
  });

  it('is an unknown tool to a call at any level, and never reaches the runner', async () => {
    for (const level of ['read', 'edit', 'export'] as const)
      await expect(callAs(level, 'audio_cloudCritique'), level).rejects.toMatchObject({
        data: { code: 'tools.not_found' },
      });
    expect(calls).toEqual([]);
  });
});
