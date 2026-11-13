// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Permission and approval hooks. The rule the agent's autonomy levels build
 * on: destructive and external tools never run without an approval id, at
 * any level, whatever the policy says.
 */
import { newId, ok, unwrap, type ToolContextBase, type ToolEditorContext } from '@taalcut/core';
import type { ToolAuthorizeRequest, ToolGateRequest, ToolPolicy } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { approvingPolicy, fxModule, fxTool, inRun, recordingBus, setup } from './helpers';

describe('approval for destructive and external tools', () => {
  it.each(['testdomain.deleteClip', 'testdomain.shareClip'])(
    '%s is refused when there is no policy',
    async (tool) => {
      const { bus, calls } = recordingBus();
      const { executor } = setup({ commands: bus });
      const result = await executor.execute(tool, { id: 'c1' }, inRun());
      expect(!result.ok && result.error).toMatchObject({ code: 'tools.approval_required', params: { tool } });
      expect(calls).toEqual([]);
    },
  );

  it('is refused when the policy allows without an approval id', async () => {
    const { bus, calls } = recordingBus();
    const lax: ToolPolicy = { authorize: () => ({ kind: 'allow' }) };
    const { executor } = setup({ commands: bus, policy: lax });
    const result = await executor.execute('testdomain.deleteClip', { id: 'c1' }, inRun());
    expect(!result.ok && result.error.code).toBe('tools.approval_required');
    expect(calls).toEqual([]);
  });

  it('runs with an approval id and returns it for the run log', async () => {
    const { bus, calls } = recordingBus();
    const { policy, approvals } = approvingPolicy();
    const { executor } = setup({ commands: bus, policy });
    const result = unwrap(await executor.execute('testdomain.deleteClip', { id: 'c1' }, inRun()));
    expect(result).toMatchObject({ value: { deleted: true }, approvalId: 'approval-1' });
    expect(approvals).toEqual(['approval-1:testdomain.deleteClip']);
    expect(calls.map((c) => c.command)).toEqual(['testdomain.deleteClip']);
  });

  it('does not ask for approval on read and write tools by itself', async () => {
    const requests: ToolAuthorizeRequest[] = [];
    const policy: ToolPolicy = { authorize: (r) => (requests.push(r), { kind: 'allow' }) };
    const { bus } = recordingBus();
    const { executor } = setup({ commands: bus, policy });
    unwrap(await executor.execute('testdomain.renameClip', { id: 'c1', title: 'Sunset' }, inRun()));
    unwrap(await executor.execute('testdomain.countWords', { text: 'x' }));
    expect(requests.map((r) => [r.tool.name, r.approvalRequired])).toEqual([
      ['testdomain.renameClip', false],
      ['testdomain.countWords', false],
    ]);
  });
});

describe('approval for checkpoint tools (render, export)', () => {
  const render = fxTool({
    name: 'fx.render',
    sideEffect: 'write',
    command: 'fx.render',
    checkpoint: true,
    idempotencyKey: () => 'final',
    run: async () => ok({ n: 1 }),
  });
  const lax: ToolPolicy = { authorize: () => ({ kind: 'allow' }) };

  it('is refused on an allow with no approval id, so a policy bug can’t skip the stop', async () => {
    const requests: ToolAuthorizeRequest[] = [];
    const policy: ToolPolicy = { authorize: (r) => (requests.push(r), { kind: 'allow' }) };
    const { executor } = setup({ modules: [fxModule(render)], policy });
    const result = await executor.execute('fx.render', {}, inRun());
    expect(!result.ok && result.error.code).toBe('tools.approval_required');
    expect(requests[0]?.approvalRequired).toBe(true);
  });

  it('runs with an approval id, or unasked when the call says checkpoints are preapproved (autopilot)', async () => {
    const { policy } = approvingPolicy();
    const approved = setup({ modules: [fxModule(render)], policy });
    expect((await approved.executor.execute('fx.render', {}, inRun())).ok).toBe(true);
    const autopilot = setup({ modules: [fxModule(render)], policy: lax });
    const result = await autopilot.executor.execute(
      'fx.render',
      {},
      { ...inRun(), checkpointsPreapproved: true },
    );
    expect(result.ok && result.value.approvalId).toBeUndefined();
  });
});

describe('authorize: budgets and autonomy', () => {
  it('passes the cost estimate before an expensive tool runs, and returns it', async () => {
    const requests: ToolAuthorizeRequest[] = [];
    const policy: ToolPolicy = { authorize: (r) => (requests.push(r), { kind: 'allow' }) };
    const { executor } = setup({ policy });
    const runId = newId<'AgentRun'>();
    const result = unwrap(await executor.execute('testdomain.captionFrame', { frame: 'f1' }, { runId }));
    expect(requests[0]).toMatchObject({
      tool: { name: 'testdomain.captionFrame', costClass: 'cloud' },
      input: { frame: 'f1' },
      inputHash: result.inputHash,
      callId: result.callId,
      runId,
      estimate: { usd: 0.004, tokens: 1500 },
      approvalRequired: false,
    });
    expect(result.estimate).toEqual(requests[0]?.estimate);
    expect(result.usage).toEqual({ usd: 0.003, inputTokens: 1200, outputTokens: 20 });
  });

  it('maps deny to tools.denied and defer to tools.awaiting_approval, without running', async () => {
    let decision: 'deny' | 'defer' = 'deny';
    const policy: ToolPolicy = { authorize: async () => ({ kind: decision, reason: 'over budget' }) };
    const { bus, calls } = recordingBus();
    const { executor } = setup({ policy, commands: bus });
    const denied = await executor.execute('testdomain.renameClip', { id: 'c1', title: 'A' }, inRun());
    expect(!denied.ok && denied.error).toMatchObject({ code: 'tools.denied', detail: 'over budget' });
    decision = 'defer';
    const deferred = await executor.execute('testdomain.renameClip', { id: 'c1', title: 'A' }, inRun());
    expect(!deferred.ok && deferred.error).toMatchObject({
      code: 'tools.awaiting_approval',
      detail: 'over budget',
    });
    expect(calls).toEqual([]);
  });

  it('runs a deferred call once the user answers, under the same call id', async () => {
    let answered = false;
    const policy: ToolPolicy = {
      authorize: () => (answered ? { kind: 'allow', approvalId: 'a-9' } : { kind: 'defer', reason: 'asked' }),
    };
    const { bus } = recordingBus();
    const { executor } = setup({ policy, commands: bus });
    const call = { callId: newId<'ToolRun'>(), ...inRun() };
    expect((await executor.execute('testdomain.deleteClip', { id: 'c2' }, call)).ok).toBe(false);
    answered = true;
    const result = unwrap(await executor.execute('testdomain.deleteClip', { id: 'c2' }, call));
    const callId = call.callId;
    expect(result).toMatchObject({ callId, approvalId: 'a-9' });
  });
});

describe('checkPermission: settings', () => {
  it('sees the declared permission and can deny or defer before anything else', async () => {
    const seen: ToolGateRequest[] = [];
    const localOnly: ToolPolicy = {
      checkPermission: (r) => {
        seen.push(r);
        if (r.tool.permission.network === 'internet') return { kind: 'deny', reason: 'local-only mode' };
        if (r.tool.permission.filesystem?.read?.includes('library'))
          return { kind: 'defer', reason: 'grant library' };
        return { kind: 'allow' };
      },
      authorize: () => {
        throw new Error('authorize must not be reached');
      },
    };
    const { executor } = setup({ policy: localOnly });
    const cloud = await executor.execute('testdomain.captionFrame', { frame: 'f' });
    expect(!cloud.ok && cloud.error).toMatchObject({
      code: 'tools.permission_denied',
      detail: 'local-only mode',
    });
    const library = await executor.execute('testdomain.listClips', {});
    expect(!library.ok && library.error.code).toBe('tools.awaiting_approval');
    expect(seen.map((r) => r.tool.name)).toEqual(['testdomain.captionFrame', 'testdomain.listClips']);
  });
});

describe('commands', () => {
  it('dispatches the declared command with source agent, run, call and idempotency key', async () => {
    const { bus, calls } = recordingBus();
    const { executor } = setup({ commands: bus });
    const runId = newId<'AgentRun'>();
    const result = unwrap(
      await executor.execute('testdomain.renameClip', { id: 'c1', title: 'Sunset' }, { runId }),
    );
    expect(calls).toEqual([
      {
        command: 'testdomain.renameClip',
        payload: { id: 'c1', title: 'Sunset' },
        meta: {
          source: 'agent',
          tool: 'testdomain.renameClip',
          callId: result.callId,
          runId,
          idempotencyKey: `${runId}:testdomain.renameClip:c1:Sunset`,
          signal: expect.any(AbortSignal),
        },
      },
    ]);
  });

  it('dispatches with an MCP origin when the call names one (P3-V4)', async () => {
    const { bus, calls } = recordingBus();
    const { executor } = setup({ commands: bus });
    const scope = 'mcp-run';
    unwrap(
      await executor.execute(
        'testdomain.renameClip',
        { id: 'c1', title: 'Dusk' },
        { scope, origin: { source: 'mcp', actor: 'mcp:01J0000000000000000000000' } },
      ),
    );
    expect(calls[0]?.meta).toMatchObject({ source: 'mcp', actor: 'mcp:01J0000000000000000000000' });
  });

  it('gives the tool what a docked run pointed at as ctx.editor, and nothing outside one (EDT1-OPS)', async () => {
    const seen: (ToolContextBase['editor'] | 'none')[] = [];
    const { executor } = setup({
      modules: [
        fxModule(fxTool({ run: async (_input, ctx) => (seen.push(ctx.editor ?? 'none'), ok({ n: 1 })) })),
      ],
    });
    const editor = { context: { timelineId: 't' }, targets: [] } as unknown as ToolEditorContext;
    unwrap(await executor.execute('fx.thing', {}, { ...inRun(), editor }));
    unwrap(await executor.execute('fx.thing', { n: 2 }, inRun()));
    expect(seen).toEqual([editor, 'none']);
  });

  it('mends a call’s input with the tool’s mendInput before checking it (EDT1-OPS)', async () => {
    const seen: number[] = [];
    const renamed = fxTool({
      input: z.object({ n: z.number() }),
      // The field was `count`; an older caller still sends it.
      mendInput: (input) => {
        const raw = input as Record<string, unknown>;
        return raw.n === undefined && raw.count !== undefined ? { n: raw.count } : input;
      },
      run: async (input) => (seen.push((input as { n: number }).n), ok({ n: 1 })),
    });
    const { executor } = setup({ modules: [fxModule(renamed)] });
    unwrap(await executor.execute('fx.thing', { count: 3 }, inRun()));
    unwrap(await executor.execute('fx.thing', { n: 4 }, inRun()));
    const neither = await executor.execute('fx.thing', {}, inRun());
    expect(!neither.ok && neither.error.code).toBe('tools.invalid_input');
    expect(seen).toEqual([3, 4]);
  });

  it('fails clearly when no command bus is wired, and passes bus errors through', async () => {
    const { executor } = setup();
    const result = await executor.execute('testdomain.renameClip', { id: 'c1', title: 'A' }, inRun());
    expect(!result.ok && result.error).toMatchObject({
      code: 'tools.service_unavailable',
      params: { service: 'commands' },
    });
    const failing = setup({ commands: recordingBus(true).bus });
    const failed = await failing.executor.execute('testdomain.renameClip', { id: 'c1', title: 'A' }, inRun());
    expect(!failed.ok && failed.error.code).toBe('testdomain.captioner_busy');
  });

  it('returns the domain error when the tool refuses before dispatching', async () => {
    const { bus, calls } = recordingBus();
    const { executor } = setup({ commands: bus });
    const result = await executor.execute('testdomain.renameClip', { id: 'missing', title: 'A' }, inRun());
    expect(!result.ok && result.error).toMatchObject({
      code: 'testdomain.clip_missing',
      params: { id: 'missing' },
    });
    expect(calls).toEqual([]);
  });
});
