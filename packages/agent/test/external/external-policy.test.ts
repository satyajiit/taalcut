// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P3-V4: the session's level, Local only as it is now, and the approval card naming who asked. */
import { cardSchema, newId, unwrap, type AnyTool, type McpLevel } from '@taalcut/core';
import { levelAllows, withLocalOnlyNow, withRequesterCard } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { clipsModule } from '../support/fixtures';
import { registryFor } from '../support/harness';

const registry = registryFor([clipsModule()]);
const tool = (name: string) => {
  const found = registry.resolve(name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

describe('the session level', () => {
  it('read: reads only; edit: no checkpoint or external tools; export: everything', () => {
    const names = [
      'clips.countWords',
      'clips.renameClip',
      'clips.deleteClip',
      'clips.shareClip',
      'clips.renderVideo',
    ];
    const allowed = (level: McpLevel) => names.filter((n) => levelAllows(level, tool(n).descriptor));
    expect(allowed('read')).toEqual(['clips.countWords']);
    expect(allowed('edit')).toEqual(['clips.countWords', 'clips.renameClip', 'clips.deleteClip']);
    expect(allowed('export')).toEqual(names);
  });
});

describe('Local only as it is now', () => {
  it('refuses internet tools only while it is on, and asks the policy otherwise', async () => {
    let on = false;
    const gate = (name: string) => ({
      tool: tool(name).descriptor,
      input: {},
      inputHash: 'h',
      callId: newId<'ToolRun'>(),
    });
    const bare = withLocalOnlyNow({}, () => on);
    expect(await bare.checkPermission?.(gate('clips.shareClip'))).toEqual({ kind: 'allow' });
    on = true;
    expect(await bare.checkPermission?.(gate('clips.shareClip'))).toMatchObject({ kind: 'deny' });
    expect(await bare.checkPermission?.(gate('clips.countWords'))).toEqual({ kind: 'allow' });
    const policy = { checkPermission: () => ({ kind: 'deny' as const, reason: 'no' }) };
    expect(withLocalOnlyNow(policy, undefined)).toBe(policy);
  });
});

async function cardOf(spec: AnyTool | undefined, input: unknown, approvalId: string) {
  if (!spec?.approvalCard) throw new Error('no approval card');
  const ctx = {
    runId: newId<'AgentRun'>(),
    toolCallId: newId<'ToolRun'>(),
    projectId: null,
    signal: new AbortController().signal,
    approvalId,
  };
  return unwrap(await spec.approvalCard(input, ctx));
}

describe('the requester card', () => {
  it("names the session on a tool's approval card, its one-liner as summary", async () => {
    const spec = withRequesterCard(tool('clips.deleteClip').spec, () => ({
      kind: 'mcp',
      sessionId: newId<'McpSession'>(),
      name: 'Codex on this Mac',
    }));
    const card = await cardOf(spec, { id: 'c1' }, 'a1');
    expect(cardSchema.safeParse(card).success).toBe(true);
    expect(card).toMatchObject({
      summary: 'Deletes a clip from the library and moves its file to the Trash.',
      details: '{"id":"c1"}',
      requester: { kind: 'mcp', name: 'Codex on this Mac' },
    });
    const anonymous = withRequesterCard(tool('clips.renderVideo').spec, () => undefined);
    const plain = await cardOf(anonymous, { preset: 'reel' }, 'a2');
    expect(plain).toMatchObject({ sideEffect: 'write' });
    expect('requester' in plain).toBe(false);
    expect(withRequesterCard(undefined, () => undefined)).toBeUndefined();
  });
});
