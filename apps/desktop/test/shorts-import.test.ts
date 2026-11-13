// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CommandBusToken,
  CancelledError,
  createContainer,
  err,
  ExperimentSandboxToken,
  IMPORT_COMMANDS,
  JobRunnerToken,
  newId,
  ok,
  unwrap,
  type CommandBus,
  type CommandToolContext,
  type ExperimentSandbox,
} from '@taalcut/core';
import type { LibraryDatabase } from '@taalcut/library';
import { createShortsProjectTool, shortsToolModule, type ShortsService } from '@taalcut/shorts';
import { createToolRegistry } from '@taalcut/tools';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { shortsImportToolModule } from '../src/utility/roots/shorts-import';

const mocks = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  imported: vi.fn(),
  ready: vi.fn(),
  cancelled: vi.fn(),
}));
vi.mock('@taalcut/library', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createShortsCache: () => ({
    get: async (key: string) => ok(mocks.cache.get(key) ?? null),
    put: async (key: string, value: unknown) => {
      mocks.cache.set(key, value);
      return ok(undefined);
    },
  }),
}));
vi.mock('../src/utility/roots/shorts-import-wait', () => ({
  awaitShortsImport: mocks.imported,
  awaitShortsSourceReady: mocks.ready,
  isShortsImportCancelled: mocks.cancelled,
}));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shorts-import-test-'));
  mocks.cache.clear();
  mocks.imported.mockReset();
  mocks.ready.mockReset();
  mocks.cancelled.mockReset().mockReturnValue(false);
});
afterEach(async () => rm(root, { recursive: true, force: true }));

function setup(localOnly = false, hasMetadata = true) {
  const container = createContainer();
  const assetId = newId<'Asset'>();
  const draftId = newId<'ImportDraft'>();
  const sessionId = newId<'ImportSession'>();
  const events: string[] = [];
  mocks.imported.mockImplementation(async () => {
    events.push('copied');
    return ok(assetId);
  });
  mocks.ready.mockImplementation(async () => {
    events.push('ready');
    return ok(undefined);
  });
  const dispatch = vi.fn(async (name: string, payload: unknown) => {
    events.push(name);
    if (name === IMPORT_COMMANDS.updateDraft)
      expect(payload).toMatchObject({ storage: 'copy', selectAll: true });
    return ok({ result: name === IMPORT_COMMANDS.start ? { sessionId } : { draftId } });
  });
  const discard = vi.fn(async () => {
    events.push('discard');
    return ok({ freedBytes: 1 });
  });
  const sandbox = {
    open: vi.fn(async (input: Parameters<ExperimentSandbox['open']>[0]) =>
      ok({ ...input, dir: root, createdAt: 0, expiresAt: 1 }),
    ),
    get: vi.fn(async (id: string) => ok({ id, dir: root })),
    discard,
  } as unknown as ExperimentSandbox;
  const fetch = vi.fn(async () =>
    ok({
      file: 'reference.mp4',
      bytes: 1,
      platform: 'other' as const,
      url: 'https://www.youtube.com/watch?v=abcDEF12345',
      duration: { value: 3600, rate: { num: 1, den: 1 } },
      sound: null,
      source: 'anonymous' as const,
      hasAudio: true,
      ...(hasMetadata ? { metadata: { channel: 'Creator' } } : {}),
    }),
  );
  container.value(LibraryDatabaseToken, {} as LibraryDatabase);
  container.value(CommandBusToken, { dispatch } as unknown as CommandBus);
  container.value(ExperimentSandboxToken, sandbox);
  container.value(JobRunnerToken, { run: fetch } as never);
  const ctx: CommandToolContext = {
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    signal: new AbortController().signal,
    artifacts: { put: vi.fn(), get: vi.fn() },
    reportUsage: vi.fn(),
    reportProgress: vi.fn(),
    dispatch: vi.fn(async () => ok({ draftId })),
  };
  const module = shortsImportToolModule(container, { localOnly });
  const tool = module.tools[0]!;
  return { assetId, sessionId, events, fetch, discard, ctx, tool, module, dispatch };
}

it.each([true, false])(
  'adopts a managed copy and preserves its backlink with metadata=%s',
  async (hasMetadata) => {
    const state = setup(false, hasMetadata);
    const input = state.tool.input.parse({
      projectId: newId<'Project'>(),
      url: 'https://youtu.be/abcDEF12345?si=token',
    });
    const result = unwrap(await state.tool.run(input, state.ctx as never));
    expect(result).toMatchObject({
      assetId: state.assetId,
      sessionId: state.sessionId,
      sourceUrl: 'https://www.youtube.com/watch?v=abcDEF12345',
    });
    expect(state.ctx.dispatch).toHaveBeenCalledWith({
      method: 'files',
      paths: [join(root, 'reference.mp4')],
      watch: false,
    });
    expect(state.events).toEqual(['imports.updateDraft', 'imports.start', 'copied', 'discard', 'ready']);
    expect(mocks.cache.get(`shorts.sourceMetadata:${state.assetId}`)).toEqual({
      ...(hasMetadata ? { channel: 'Creator' } : {}),
      sourceUrl: 'https://www.youtube.com/watch?v=abcDEF12345',
    });
    unwrap(await state.tool.run(input, state.ctx as never));
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.ctx.dispatch).toHaveBeenCalledTimes(1);
  },
);

it('accepts local files in local-only mode and refuses a network source before fetching', async () => {
  const state = setup(true);
  const path = join(root, 'creator.mov');
  await writeFile(path, 'video');
  expect(
    (
      await state.tool.run(
        state.tool.input.parse({ projectId: newId<'Project'>(), path }),
        state.ctx as never,
      )
    ).ok,
  ).toBe(true);
  expect(
    (
      await state.tool.run(
        state.tool.input.parse({ projectId: newId<'Project'>(), url: 'https://youtu.be/abcDEF12345' }),
        state.ctx as never,
      )
    ).ok,
  ).toBe(false);
  expect(state.fetch).not.toHaveBeenCalled();
  expect(state.tool.permission?.network).toBe('none');
});

it('rejects a wrapped or malformed createDraft receipt without starting an import', async () => {
  const state = setup();
  state.ctx.dispatch = vi.fn(async () => ok({ result: { draftId: newId<'ImportDraft'>() } }));
  const result = await state.tool.run(
    state.tool.input.parse({ projectId: newId<'Project'>(), url: 'https://youtu.be/abcDEF12345' }),
    state.ctx as never,
  );
  expect(result.ok).toBe(false);
  expect(state.dispatch).not.toHaveBeenCalled();
  expect(state.discard).not.toHaveBeenCalled();
});

it.each(['file', 'youtube'] as const)(
  'starts a fresh managed import after cancelling a %s copy',
  async (source) => {
    const state = setup();
    const path = join(root, 'creator.mov');
    await writeFile(path, 'video');
    const input = state.tool.input.parse({
      projectId: newId<'Project'>(),
      ...(source === 'file' ? { path } : { url: 'https://youtu.be/abcDEF12345' }),
    });
    const controller = new AbortController();
    mocks.imported.mockImplementationOnce(async () => {
      controller.abort();
      return err(CancelledError());
    });
    const cancelled = await state.tool.run(input, { ...state.ctx, signal: controller.signal } as never);
    expect(!cancelled.ok && CancelledError.is(cancelled.error)).toBe(true);
    expect(state.discard).not.toHaveBeenCalled();
    const receiptKey = [...mocks.cache.keys()].find((key) => key.startsWith('shorts.import:'))!;
    expect(mocks.cache.get(receiptKey)).toMatchObject({ retry: 1 });
    expect(mocks.cache.get(receiptKey)).not.toHaveProperty('sessionId', state.sessionId);
    if (source === 'youtube') {
      // Simulate a process exit after imports.cancel committed but before the receipt was retired.
      mocks.cache.set(receiptKey, {
        ...(mocks.cache.get(receiptKey) as Record<string, unknown>),
        sessionId: state.sessionId,
        draftId: newId<'ImportDraft'>(),
        retry: 0,
      });
      mocks.cancelled.mockReturnValueOnce(true);
    }

    const nextDraftId = newId<'ImportDraft'>();
    const nextSessionId = newId<'ImportSession'>();
    state.dispatch.mockImplementation(async (name) =>
      ok({
        result: name === IMPORT_COMMANDS.start ? { sessionId: nextSessionId } : { draftId: nextDraftId },
      }),
    );
    const retried = unwrap(await state.tool.run(input, state.ctx as never));
    expect(retried).toMatchObject({ assetId: state.assetId, sessionId: nextSessionId });
    expect(state.ctx.dispatch).toHaveBeenCalledTimes(1);
    expect(state.dispatch).toHaveBeenCalledWith(
      IMPORT_COMMANDS.createDraft,
      { method: 'files', paths: [source === 'file' ? path : join(root, 'reference.mp4')], watch: false },
      expect.anything(),
      expect.objectContaining({ idempotencyKey: `${receiptKey}:create:1` }),
    );
    expect(mocks.imported).toHaveBeenLastCalledWith(expect.anything(), nextSessionId, state.ctx.signal);
    expect(state.fetch).toHaveBeenCalledTimes(source === 'file' ? 0 : 1);
    // A later retry must reuse an already copied asset, even if its old session is no longer resumable.
    mocks.cancelled.mockReturnValue(true);
    expect(unwrap(await state.tool.run(input, state.ctx as never))).toEqual(retried);
    expect(mocks.imported).toHaveBeenCalledTimes(2);
  },
);

it('registers all shorts tool input and output schemas in the real registry', () => {
  const imported = setup();
  const service: ShortsService = { generate: vi.fn(), regenerate: vi.fn(), get: vi.fn() };
  const editorial = shortsToolModule({ service: () => service, get: service.get });
  const project = createShortsProjectTool({ run: async () => ok({ projectId: newId<'Project'>() }) });
  const registry = unwrap(
    createToolRegistry([{ id: 'shorts', tools: [project, ...editorial.tools, ...imported.module.tools] }]),
  );
  expect(registry.catalogue()).toHaveLength(5);
});
