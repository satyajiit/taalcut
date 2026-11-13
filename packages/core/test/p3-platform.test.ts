// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3's platform contract (round P3-1): external agents over MCP, updates and the beta terms, onboarding's
 * branches, the app's language, accounts' stock keys, privacy's new refusals and flows, files and components.
 */
import { describe, expect, it } from 'vitest';
import {
  accountsStateSchema,
  BETA_TERMS,
  componentSchema,
  createCommandBus,
  createEventBus,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  createSettingsCommands,
  defineTool,
  FILE_PICK_PURPOSES,
  filesContract,
  GO_LANGUAGE_COMMAND,
  LOCAL_ONLY_REFUSALS,
  LOCALE_PREFERENCES,
  LOCALE_SETTING,
  localeStateSchema,
  MCP_COMMANDS,
  MCP_DEFAULT_PORT,
  MCP_ENABLED_SETTING,
  MCP_PORT_SETTING,
  MCP_SESSIONS_SETTING,
  MCP_TOKEN_PATTERN,
  mcpCallItemSchema,
  mcpCommandPayloads,
  mcpGatewayContract,
  mcpSessionRecordSchema,
  mcpSessionViewSchema,
  mcpSetupContract,
  mcpStateSchema,
  mcpToolDefSchema,
  newId,
  NO_TOOL_RETRY,
  ok,
  ONBOARDING_COMMANDS,
  onboardingCommandPayloads,
  OTHER_NETWORK_FLOWS,
  privacyOverviewSchema,
  PUBLIC_UPDATE_CHANNELS,
  systemClock,
  TEMPLATE_FILE_EXTENSION,
  UPDATE_BLOCKED_SETTING,
  UPDATE_CHANNEL_SETTING,
  UPDATE_COMMANDS,
  updateCommandPayloads,
  updateStateSchema,
} from '@taalcut/core';
import { z } from 'zod';
import { SHA, T0 } from './helpers/documents';
import { inputOf, outputOf } from './helpers/phase3';

const sessionId = newId<'McpSession'>();
const record = {
  id: sessionId,
  name: 'Claude Code on my Mac',
  client: 'claude-code',
  level: 'edit',
  tokenHash: SHA,
  createdAt: T0,
  lastUsedAt: null,
  revokedAt: null,
  runId: newId<'AgentRun'>(),
  conversationId: newId<'Conversation'>(),
} as const;

describe('external agents (MCP)', () => {
  it('keeps sessions by their token hash, off by default, and never shows the hash', () => {
    expect(mcpSessionRecordSchema.parse(record)).toEqual(record);
    expect(mcpSessionRecordSchema.safeParse({ ...record, tokenHash: 'tcm_secret' }).success).toBe(false);
    const view = mcpSessionViewSchema.parse({
      ...record,
      status: 'active',
      callsToday: 3,
      pendingApprovals: 0,
    });
    expect('tokenHash' in view).toBe(false);
    expect(MCP_ENABLED_SETTING.defaultValue).toBe(false);
    expect(MCP_PORT_SETTING.defaultValue).toBe(MCP_DEFAULT_PORT);
    expect(MCP_SESSIONS_SETTING.defaultValue).toEqual([]);
    expect(MCP_PORT_SETTING.schema.safeParse(80).success).toBe(false);
    expect(MCP_TOKEN_PATTERN.test(`tcm_${'a'.repeat(43)}`)).toBe(true);
    expect(MCP_TOKEN_PATTERN.test(`tcm_${'a'.repeat(42)}`)).toBe(false);
    const state = {
      enabled: true,
      server: { state: 'listening', port: MCP_DEFAULT_PORT, url: 'http://127.0.0.1:41730/mcp' },
      sessions: [view],
    };
    expect(mcpStateSchema.parse(state).sessions).toHaveLength(1);
  });

  it('changes MCP settings and sessions through commands that name neither a token nor a hash', () => {
    expect(mcpCommandPayloads[MCP_COMMANDS.setPort].safeParse({ port: 65_536 }).success).toBe(false);
    expect(mcpCommandPayloads[MCP_COMMANDS.setEnabled].parse({ enabled: true })).toEqual({ enabled: true });
    expect(mcpCommandPayloads[MCP_COMMANDS.revokeSession].safeParse({ sessionId }).success).toBe(true);
    expect(mcpCommandPayloads[MCP_COMMANDS.renameSession].safeParse({ sessionId, name: '' }).success).toBe(
      false,
    );
    expect(
      mcpCommandPayloads[MCP_COMMANDS.setSessionLevel].safeParse({ sessionId, level: 'export' }).success,
    ).toBe(true);
  });

  it('copies setup text without returning a token', () => {
    const created = outputOf(mcpSetupContract.createSession, { sessionId, copied: 'claude-http' });
    expect(created.success && created.data).toEqual({ sessionId, copied: 'claude-http' });
    expect(inputOf(mcpSetupContract.copySetup, { sessionId, format: 'cursor' }).success).toBe(false);
    expect(inputOf(mcpSetupContract.rotateToken, { sessionId, copy: 'codex-stdio' }).success).toBe(true);
  });

  it('lists tools and runs calls through the gateway', () => {
    const tool = {
      name: 'library_search',
      title: 'Search the library',
      description: 'Finds shots.',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    };
    expect(mcpToolDefSchema.parse(tool)).toEqual(tool);
    expect(mcpToolDefSchema.safeParse({ ...tool, name: 'library.search' }).success).toBe(false);
    expect(mcpCallItemSchema.parse({ type: 'progress', fraction: null })).toEqual({
      type: 'progress',
      fraction: null,
    });
    expect(mcpCallItemSchema.safeParse({ type: 'result', isError: false }).success).toBe(false);
    const call = { sessionId, callKey: SHA, name: 'library_search', arguments: {}, wantsProgress: true };
    expect(inputOf(mcpGatewayContract.call, call).success).toBe(true);
    expect(inputOf(mcpGatewayContract.call, { ...call, callKey: 'k' }).success).toBe(false);
    expect(inputOf(mcpGatewayContract.touch, { sessionId, protocolSession: 'has space' }).success).toBe(
      false,
    );
    expect(inputOf(mcpGatewayContract.reportStatus, { state: 'error', port: 41730 }).success).toBe(true);
  });

  it('lets a tool stay off the MCP server', () => {
    const tool = defineTool({
      name: 'sandbox.run',
      version: '1.0.0',
      description: 'Runs in the sandbox.',
      input: z.object({}),
      output: z.object({}),
      costClass: 'local',
      sideEffect: 'read',
      timeoutMs: 1_000,
      retry: NO_TOOL_RETRY,
      exposure: { mcp: false },
      run: async () => ok({}),
    });
    expect(tool.exposure).toEqual({ mcp: false });
  });
});

describe('updates and the beta', () => {
  it('reads a Phase 2 state with no choice and no rollback, and the new statuses', () => {
    const state = updateStateSchema.parse({
      version: '0.3.0',
      channel: 'beta',
      choice: 'beta',
      status: { kind: 'ready', version: '0.3.1', notes: '- **Faster** exports', releaseDate: T0 },
      lastRollback: { from: '0.3.1', to: '0.3.0', at: T0 },
    });
    expect(state.choice).toBe('beta');
    const downloading = { kind: 'downloading', version: '0.3.1', percent: 40, delta: true } as const;
    expect(updateStateSchema.parse({ version: '0.3.0', channel: null, status: downloading })).toMatchObject({
      choice: null,
      lastRollback: null,
    });
    expect(
      updateStateSchema.safeParse({ version: '0.3.0', channel: null, choice: 'alpha', status: downloading })
        .success,
    ).toBe(false);
  });

  it('keeps the channel choice and the blocked versions, and offers only public channels', () => {
    expect(PUBLIC_UPDATE_CHANNELS).toEqual(['stable', 'beta']);
    expect(UPDATE_CHANNEL_SETTING.defaultValue).toBeNull();
    expect(UPDATE_BLOCKED_SETTING.defaultValue).toEqual([]);
    const set = updateCommandPayloads[UPDATE_COMMANDS.setChannel];
    expect(set.parse({ channel: 'beta' })).toEqual({ channel: 'beta', projectId: null });
    expect(set.safeParse({ channel: 'internal' }).success).toBe(false);
    expect(BETA_TERMS).toEqual({ featureId: 'beta.terms', termsVersion: 'draft' });
  });
});

describe('onboarding', () => {
  it('records where inside a step the person was and how first run ended', () => {
    const set = onboardingCommandPayloads[ONBOARDING_COMMANDS.setProgress];
    const payload = { step: 'beta', completed: true, via: 'skipped', branch: { thinking: 'local-only' } };
    expect(set.parse(payload)).toEqual(payload);
    expect(set.safeParse({ step: 'sources', branch: { source: 'bluetooth' } }).success).toBe(false);
    expect(onboardingCommandPayloads[ONBOARDING_COMMANDS.reset].parse({})).toEqual({});
  });
});

describe('the app language', () => {
  function setup() {
    const settings = createMemorySettingsStore();
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    bus.register(...createSettingsCommands({ settings, events: createEventBus({ clock: systemClock }) }).all);
    return { settings, bus };
  }
  const ui = { source: 'ui', actor: 'user' } as const;

  it('follows the Mac until the person picks a language, and undo puts it back', async () => {
    const { settings, bus } = setup();
    expect(LOCALE_PREFERENCES[0]).toBe('system');
    expect(await settings.get(LOCALE_SETTING)).toEqual({ ok: true, value: 'system' });
    const receipt = await bus.dispatch('settings.setLocale', { preference: 'pt-BR' }, ui);
    expect(receipt).toMatchObject({ ok: true, value: { undoable: true, projectId: null } });
    expect(await settings.get(LOCALE_SETTING)).toEqual({ ok: true, value: 'pt-BR' });
    await bus.undo(null, ui);
    expect(await settings.get(LOCALE_SETTING)).toEqual({ ok: true, value: 'system' });
    const bad = await bus.dispatch('settings.setLocale', { preference: 'fr' }, ui);
    expect(!bad.ok && bad.error.code).toBe('core.validation');
  });

  it('fails the command when the settings store fails', async () => {
    const memory = createMemorySettingsStore();
    const failing = { code: 'library.database_failed', messageKey: 'x', retryable: true } as const;
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    const events = createEventBus({ clock: systemClock });
    bus.register(
      ...createSettingsCommands({
        settings: { ...memory, get: async () => ({ ok: false, error: failing }) },
        events,
      }).all,
    );
    const read = await bus.dispatch('settings.setLocale', { preference: 'es' }, ui);
    expect(!read.ok && read.error.code).toBe('library.database_failed');
    const writes = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    writes.register(
      ...createSettingsCommands({
        settings: { ...memory, set: async () => ({ ok: false, error: failing }) },
        events,
      }).all,
    );
    const written = await writes.dispatch('settings.setLocale', { preference: 'es' }, ui);
    expect(!written.ok && written.error.code).toBe('library.database_failed');
  });

  it('describes the state main serves and the command that opens the picker', () => {
    expect(
      localeStateSchema.parse({ preference: 'system', resolved: 'hi', system: ['hi-IN', 'en-GB'] }),
    ).toMatchObject({
      resolved: 'hi',
    });
    expect(localeStateSchema.safeParse({ preference: 'system', resolved: 'hi-IN', system: [] }).success).toBe(
      false,
    );
    expect(GO_LANGUAGE_COMMAND).toBe('go.language');
  });
});

describe('accounts, privacy, files and components', () => {
  it('lists stock keys apart from model keys, empty in a Phase 2 state', () => {
    const phase2 = {
      chatgpt: { signedIn: false, manageUsageUrl: 'https://chatgpt.com/settings' },
      subscriptions: [],
      apiKeys: [],
      localServers: [],
    };
    expect(accountsStateSchema.parse(phase2).stockKeys).toEqual([]);
    const withKey = { ...phase2, stockKeys: [{ provider: 'pexels', configured: true, available: true }] };
    expect(accountsStateSchema.parse(withKey).stockKeys).toHaveLength(1);
    expect(
      accountsStateSchema.safeParse({ ...phase2, stockKeys: [{ provider: 'shutterstock' }] }).success,
    ).toBe(false);
  });

  it('refuses stock and the hub under Local only and lists their flows and module quality', () => {
    expect(LOCAL_ONLY_REFUSALS).toEqual(expect.arrayContaining(['stock', 'hub']));
    expect(OTHER_NETWORK_FLOWS).toEqual(expect.arrayContaining(['stock-media', 'template-hub']));
    const overview = {
      localOnly: true,
      modules: [],
      other: [],
      switches: { telemetry: false, crashReports: false },
    };
    expect(privacyOverviewSchema.parse(overview).quality).toEqual([]);
    const quality = [{ module: 'vision', quality: 'lowerQuality', labelKey: 'privacy.quality.lower' }];
    expect(privacyOverviewSchema.parse({ ...overview, quality }).quality).toEqual(quality);
    expect(
      privacyOverviewSchema.safeParse({ ...overview, quality: [{ ...quality[0], quality: 'meh' }] }).success,
    ).toBe(false);
  });

  it('picks brand images and template files, and saves exports by name only', () => {
    expect(FILE_PICK_PURPOSES).toEqual(['reference', 'music', 'brandImage', 'templateFile']);
    expect(TEMPLATE_FILE_EXTENSION).toBe('taalcut-template');
    expect(inputOf(filesContract.saveExportAs, { fileName: 'Trip.otio' }).success).toBe(true);
    expect(inputOf(filesContract.saveExportAs, { fileName: '../Trip.otio' }).success).toBe(false);
    const template = inputOf(filesContract.saveTemplateAs, { templateId: newId<'Template'>() });
    expect(template.success && template.data).toMatchObject({ includeStyle: false });
  });

  it('shows download bytes and the time left on a component', () => {
    const component = {
      id: 'local-llm',
      name: 'Qwen',
      version: '3.5',
      licence: 'Apache-2.0',
      sizeBytes: 100,
      status: 'downloading',
      progress: 0.5,
      bytesDone: 50,
      etaMs: 4_000,
      usedBy: [],
    };
    expect(componentSchema.parse(component)).toMatchObject({ bytesDone: 50, etaMs: 4_000 });
    expect(componentSchema.safeParse({ ...component, etaMs: -1 }).success).toBe(false);
  });
});
