// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-CMD: templates.proposeEdits as the agent process serves it, over a scripted ModelClient. The call is the
 * vision module's, carries the contact sheet, is logged with the project and a span id, makes no call once the
 * project's cap is spent, and needs no consent: the frames are a reference's (FIX-CONSENT), so even a cloud model
 * answers with no consent stored anywhere.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';
import { createScriptedModelClient } from '@taalcut/agent';
import {
  AuditLogStoreToken,
  ClockToken,
  CommandBusToken,
  connectRpc,
  createCommandBus,
  createContainer,
  createManualClock,
  createMemoryAuditLogStore,
  newId,
  ok,
  ProjectBudgetStoreToken,
  serveRpc,
  TEMPLATE_COMMANDS as N,
  templatesContract,
  TemplateStoreToken,
  type CloudCallRecord,
  type ProjectBudgetStore,
  type ProjectId,
} from '@taalcut/core';
import { planFormat } from '@taalcut/templates';
import { createMemoryTemplateStore } from '@taalcut/templates/test-support';
import { ModelClientToken } from '../src/shared/tokens';
import { agentTemplatesRouter } from '../src/utility/roots/agent-templates';

const dir = mkdtempSync(join(tmpdir(), 'taalcut-template-review-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const sheetFile = join(dir, 'sheet.jpg');
writeFileSync(sheetFile, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

async function agent(options: { spent?: boolean; withModel?: boolean } = {}) {
  const clock = createManualClock(Date.UTC(2026, 9, 31));
  const memory = createMemoryTemplateStore(clock);
  const c = createContainer()
    .value(ClockToken, clock)
    .value(AuditLogStoreToken, createMemoryAuditLogStore())
    // The memory store's assets have no file; this one is a real JPEG's first bytes.
    .value(TemplateStoreToken, { ...memory, assetPath: async () => ok(sheetFile) });
  c.factory(CommandBusToken, ({ store }) => createCommandBus({ store, clock }), {
    deps: { store: AuditLogStoreToken },
  });
  const calls: CloudCallRecord[] = [];
  const reply = (slotId: string) =>
    JSON.stringify({
      proposals: [{ command: N.setRole, payload: { slotId, role: 'peak' }, why: 'The drop lands here.' }],
      note: null,
    });
  let slotId = '';
  const model = createScriptedModelClient(
    () => ({ text: reply(slotId), provider: 'anthropic', model: 'claude' }),
    {
      callLog: { record: (record) => calls.push(record) },
    },
  );
  if (options.withModel !== false) c.value(ModelClientToken, model);
  const budgets: ProjectBudgetStore = {
    get: async (projectId) =>
      ok({
        projectId,
        cap: { currency: 'USD', micros: 500_000 },
        spent: { currency: 'USD', micros: options.spent ? 500_000 : 10_000 },
      }),
    setCap: async () => ok(null),
  };
  c.value(ProjectBudgetStoreToken, budgets);
  const { port1, port2 } = new MessageChannel();
  serveRpc(agentTemplatesRouter(c), port1 as never, { context: {} });
  const client = connectRpc(templatesContract, port2 as never, { peer: 'agent' }).client;
  const template = planFormat(
    { formatId: 'vlog', targetSeconds: 20, brief: null, createdAt: 1 },
    { template: () => newId(), slot: () => newId(), overlay: () => newId() },
  );
  if (!template.ok) throw new Error(template.error.code);
  const sheet = { asset: 'b'.repeat(64), mediaType: 'image/jpeg' as const, columns: 1, rows: 1 };
  const withSheet = {
    ...template.value,
    contactSheet: { ...sheet, tile: { width: 90, height: 160 }, frames: [] },
  };
  const bus = c.resolve(CommandBusToken);
  const created = await bus.dispatch(
    N.create,
    { projectId: null, template: withSheet, name: 'A', listed: true },
    { source: 'ui', actor: 'user' },
  );
  if (!created.ok) throw new Error(created.error.code);
  slotId = withSheet.slots[1]!.id;
  return { client, model, calls, template: withSheet };
}

const projectId = newId<'Project'>() as ProjectId;

describe('templates.proposeEdits in the agent process', () => {
  it('asks the vision module with the frames, logs the call with the project and a span, and answers', async () => {
    const { client, model, calls, template } = await agent();
    const answer = await client.proposeEdits({
      templateId: template.id,
      baseVersion: 1,
      message: 'slot 2 is the drop',
      projectId,
    });
    expect(answer).toMatchObject({
      baseVersion: 1,
      proposals: [{ id: 'p1', command: N.setRole, payload: { slotId: template.slots[1]!.id, role: 'peak' } }],
      dropped: 0,
      model: { provider: 'anthropic', model: 'claude', local: false },
    });
    const [request] = model.requests;
    expect(request).toMatchObject({ module: 'vision', temperature: 0, reasoning: 'off', maxTokens: 1600 });
    const message = request!.messages[0]!;
    const parts = (message.role === 'user' ? message.content : []) as { type: string; data?: string }[];
    expect(parts.map((part) => part.type)).toEqual(['text', 'image']);
    expect(parts[1]).toEqual({ type: 'image', data: '/9j/4A==', mimeType: 'image/jpeg' });
    expect(request!.trace).toMatchObject({ projectId, spanId: expect.stringMatching(/^[0-9A-Z]{26}$/) });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ module: 'vision', projectId, spanId: request!.trace!.spanId });
  });

  it('makes no call once the project has spent its cap', async () => {
    const { client, model, template } = await agent({ spent: true });
    await expect(
      client.proposeEdits({
        templateId: template.id,
        baseVersion: 1,
        message: 'slot 2 is the drop',
        projectId,
      }),
    ).rejects.toMatchObject({ data: { code: 'templates.budget_reached' } });
    // Outside a project (the Slots page) no cap applies.
    await client.proposeEdits({ templateId: template.id, baseVersion: 1, message: 'slot 2 is the drop' });
    expect(model.requests).toHaveLength(1);
  });

  it('answers not_implemented while the process has no model client', async () => {
    const { client, template } = await agent({ withModel: false });
    await expect(
      client.proposeEdits({ templateId: template.id, baseVersion: 1, message: 'slot 2 is the drop' }),
    ).rejects.toMatchObject({ data: { code: 'core.not_implemented' } });
  });
});
