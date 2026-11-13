// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CancelledError,
  createSerialQueue,
  err,
  ok,
  pluginToolSchema,
  type AsyncResult,
  type PluginInvoke,
  type PluginSecrets,
  type PluginTool,
  type PluginView,
  type SettingsStore,
  type TaalcutError,
} from '@taalcut/core';
import { z } from 'zod';
import { createPluginCallLedger } from './call-ledger';
import { createPluginInputValidator } from './input-validator';
import {
  PluginAccessDenied,
  PluginAuthenticationFailed,
  PluginInactive,
  PluginInvalidConfig,
  PluginInvalidInput,
  PluginInvalidTool,
  PluginNotFound,
} from './errors';
import type { PluginAdapter, PluginDefinition } from './provider';
import { closePlugin, pluginAttempt, redactPluginValue } from './safe-result';
import { createPluginStateStore, scopedPluginData, scopedPluginSecrets, type PluginRecord } from './storage';

export interface PluginInstanceDeps {
  readonly settings: SettingsStore;
  readonly secrets: PluginSecrets;
  readonly networkAllowed: () => Promise<boolean>;
  readonly now: () => number;
}

export function createPluginInstance(definition: PluginDefinition, deps: PluginInstanceDeps) {
  const { manifest } = definition;
  const pluginId = manifest.id;
  const defaults = Object.fromEntries(manifest.configFields.map((field) => [field.id, field.defaultValue]));
  const defaultAccess = manifest.access.map((field) => field.id);
  const stateStore = createPluginStateStore(pluginId, defaults, defaultAccess, deps.settings);
  const secrets = scopedPluginSecrets(
    pluginId,
    manifest.credentials.map((field) => field.id),
    deps.secrets,
  );
  const data = scopedPluginData(pluginId, deps.settings);
  const ledger = createPluginCallLedger(pluginId, deps.settings);
  const validator = createPluginInputValidator(pluginId);
  let lifetime = new AbortController();
  let adapter: PluginAdapter | undefined;
  let catalogue: PluginTool[] | undefined;
  let connecting: AsyncResult<PluginTool[]> | undefined;
  const turns = createSerialQueue();
  let epoch = 0;
  let transitions = 0;
  let disposed = false;

  const record = () => stateStore.get();
  const save = (value: PluginRecord) => stateStore.save(value);
  const granted = (state: PluginRecord, tool: PluginTool) =>
    tool.access.every((id) => state.grantedAccess.includes(id));
  const signalFor = (signal?: AbortSignal) =>
    AbortSignal.any([lifetime.signal, AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]);

  async function stop(): Promise<void> {
    epoch += 1;
    lifetime.abort();
    lifetime = new AbortController();
    const previous = adapter;
    adapter = undefined;
    catalogue = undefined;
    validator.clear();
    connecting = undefined;
    if (previous) await closePlugin(() => previous.dispose());
  }

  function interrupted<T>(fn: () => AsyncResult<T>): AsyncResult<T> {
    transitions += 1;
    const stopping = stop();
    return turns.run(async () => {
      try {
        await stopping;
        // An earlier queued activation may have opened a transport after cancellation.
        await stop();
        return await fn();
      } finally {
        transitions -= 1;
      }
    });
  }

  async function credentials() {
    const configured: string[] = [];
    const values: string[] = [];
    for (const field of manifest.credentials) {
      const result = await secrets.get(field.id);
      if (!result.ok) return result;
      if (result.value) {
        configured.push(field.id);
        values.push(result.value);
      }
    }
    return ok({ configured, values });
  }

  async function view(): AsyncResult<PluginView> {
    const current = await record();
    if (!current.ok) return current;
    const stored = await credentials();
    if (!stored.ok) return stored;
    const complete = manifest.credentials.every(
      (field) => !field.required || stored.value.configured.includes(field.id),
    );
    const { defaultsApplied: _defaultsApplied, ...state } = current.value;
    const active = complete && state.enabled;
    return ok({
      ...state,
      enabled: active,
      manifest: structuredClone(manifest),
      configuredCredentials: stored.value.configured,
      status: !complete ? 'disconnected' : state.error ? 'error' : active ? 'active' : 'inactive',
    });
  }

  async function openConnection(signal?: AbortSignal): AsyncResult<PluginTool[]> {
    const generation = epoch;
    const combined = signalFor(signal);
    if (!(await deps.networkAllowed())) return err(PluginAccessDenied({ pluginId }));
    if (catalogue) return ok(catalogue);
    const current = await record();
    if (!current.ok) return current;
    const parsed = definition.configSchema.safeParse(current.value.config);
    if (!parsed.success) return err(PluginInvalidConfig({ pluginId }));
    const stored = await credentials();
    if (!stored.ok) return stored;
    if (manifest.credentials.some((field) => field.required && !stored.value.configured.includes(field.id))) {
      return err(PluginAuthenticationFailed({ pluginId }));
    }
    if (generation !== epoch || combined.aborted) return err(CancelledError());
    const allowed = <T>(fn: () => AsyncResult<T>): AsyncResult<T> =>
      generation === epoch ? fn() : Promise.resolve(err(CancelledError()));
    const active = definition.create({
      config: Object.freeze(parsed.data),
      secrets: { get: (id) => allowed(() => secrets.get(id)) },
      data: {
        get: (key) => allowed(() => data.get(key)),
        set: (key, value) => allowed(() => data.set(key, value)),
        delete: (key) => allowed(() => data.delete(key)),
        clear: () => allowed(() => data.clear()),
      },
    });
    adapter = active;
    const result = await pluginAttempt(pluginId, combined, async () => {
      const result = await active.connect(combined);
      if (combined.aborted) {
        await closePlugin(() => active.dispose());
        return err(CancelledError());
      }
      if (!result.ok) return result;
      const checked = z.array(pluginToolSchema).max(500).safeParse(result.value);
      if (!checked.success) return err(PluginInvalidTool({ pluginId }));
      const names = new Set<string>();
      for (const tool of checked.data) {
        if (
          names.has(tool.name) ||
          tool.access.some((id) => !manifest.access.some((access) => access.id === id))
        ) {
          return err(PluginInvalidTool({ pluginId }));
        }
        names.add(tool.name);
      }
      const registered = validator.register(checked.data);
      return registered.ok ? ok(redactPluginValue(checked.data, stored.value.values)) : registered;
    });
    if (generation !== epoch) return err(CancelledError());
    if (result.ok) catalogue = result.value;
    else {
      adapter = undefined;
      await closePlugin(() => active.dispose());
    }
    return redactPluginValue(result, stored.value.values);
  }

  function connection(signal?: AbortSignal, internal = false): AsyncResult<PluginTool[]> {
    if (disposed || (transitions && !internal)) return Promise.resolve(err(PluginInactive({ pluginId })));
    if (connecting) return pluginAttempt(pluginId, signalFor(signal), () => connecting!);
    const pending = openConnection(signal);
    connecting = pending;
    void pending.finally(() => {
      if (connecting === pending) connecting = undefined;
    });
    return pending;
  }

  async function markChecked(error?: TaalcutError, activate = false) {
    const current = await record();
    if (!current.ok) return current;
    const { error: _previous, ...rest } = current.value;
    const safe = error
      ? { code: error.code, messageKey: error.messageKey, retryable: error.retryable }
      : undefined;
    const grantedAccess = rest.grantedAccess.length > 0 ? rest.grantedAccess : [...defaultAccess];
    return save({
      ...rest,
      ...(activate && !error ? { enabled: true, grantedAccess, setupRequested: false } : {}),
      lastCheckedAt: deps.now(),
      ...(safe ? { error: safe } : {}),
    });
  }

  async function invalidateCredentials(): AsyncResult<void> {
    for (const field of manifest.credentials) {
      const removed = await secrets.delete(field.id);
      if (!removed.ok) return removed;
    }
    return ok(undefined);
  }

  return {
    describe: view,
    async tools(signal?: AbortSignal): AsyncResult<PluginTool[]> {
      if (disposed || transitions) return err(PluginInactive({ pluginId }));
      const state = await record();
      if (!state.ok) return state;
      if (!state.value.enabled) return err(PluginInactive({ pluginId }));
      const tools = await connection(signal);
      if (!tools.ok) return tools;
      const latest = await record();
      if (!latest.ok) return latest;
      if (!latest.value.enabled) return err(PluginInactive({ pluginId }));
      return ok(structuredClone(tools.value.filter((tool) => granted(latest.value, tool))));
    },
    async readSkill(skillId: string) {
      const skill = definition.skills.find((item) => item.id === skillId);
      return skill ? ok(structuredClone(skill)) : err(PluginNotFound({ pluginId }));
    },
    configure: (config: Record<string, string>) =>
      interrupted(async () => {
        const parsed = definition.configSchema.safeParse(config);
        if (!parsed.success) return err(PluginInvalidConfig({ pluginId }));
        const state = await record();
        if (!state.ok) return state;
        if (JSON.stringify(state.value.config) === JSON.stringify(parsed.data)) return view();
        const removed = await invalidateCredentials();
        if (!removed.ok) return removed;
        const calls = await ledger.clear();
        if (!calls.ok) return calls;
        const cleared = await data.clear();
        if (!cleared.ok) return cleared;
        const saved = await save({
          ...state.value,
          config: parsed.data,
          enabled: false,
          grantedAccess: [],
          error: undefined,
        });
        return saved.ok ? view() : saved;
      }),
    setEnabled: (enabled: boolean) =>
      interrupted(async () => {
        const state = await record();
        if (!state.ok) return state;
        if (enabled) {
          const connected = await connection(undefined, true);
          const checked = await markChecked(connected.ok ? undefined : connected.error);
          if (!checked.ok) return checked;
          if (!connected.ok) return connected;
        }
        const latest = await record();
        if (!latest.ok) return latest;
        const saved = await save({ ...latest.value, enabled, setupRequested: false });
        return saved.ok ? view() : saved;
      }),
    setAccess: (access: string[]) =>
      interrupted(async () => {
        if (access.some((id) => !manifest.access.some((item) => item.id === id)))
          return err(PluginInvalidInput({ pluginId }));
        const state = await record();
        if (!state.ok) return state;
        const saved = await save({ ...state.value, grantedAccess: [...new Set(access)] });
        return saved.ok ? view() : saved;
      }),
    disconnect: () =>
      interrupted(async () => {
        const state = await record();
        if (!state.ok) return state;
        const removed = await invalidateCredentials();
        if (!removed.ok) return removed;
        const cleared = await data.clear();
        if (!cleared.ok) return cleared;
        const calls = await ledger.clear();
        if (!calls.ok) return calls;
        const saved = await save({
          ...state.value,
          enabled: false,
          grantedAccess: [],
          error: undefined,
          lastCheckedAt: null,
        });
        return saved.ok ? view() : saved;
      }),
    requestSetup: () =>
      turns.run(async () => {
        const state = await record();
        if (!state.ok) return state;
        const saved = await save({ ...state.value, setupRequested: true });
        return saved.ok ? view() : saved;
      }),
    testConnection: (signal?: AbortSignal) =>
      interrupted(async () => {
        const result = await connection(signal, true);
        const checked = await markChecked(result.ok ? undefined : result.error, result.ok);
        if (!checked.ok) return checked;
        return result.ok ? view() : result;
      }),
    importCredential: (credentialId: string, value: string) =>
      interrupted(async () => {
        if (
          !manifest.credentials.some((field) => field.id === credentialId) ||
          !value.trim() ||
          value.length > 16_384 ||
          /[\r\n\0]/.test(value)
        ) {
          return err(PluginInvalidInput({ pluginId }));
        }
        const stored = await secrets.set(credentialId, value.trim());
        if (!stored.ok) return stored;
        const calls = await ledger.clear();
        if (!calls.ok) return calls;
        const cleared = await data.clear();
        if (!cleared.ok) return cleared;
        const state = await record();
        if (!state.ok) return state;
        const saved = await save({
          ...state.value,
          enabled: true,
          grantedAccess: [...defaultAccess],
          setupRequested: false,
          error: undefined,
          lastCheckedAt: null,
        });
        return saved.ok ? view() : saved;
      }),
    async invoke(input: PluginInvoke, signal?: AbortSignal): AsyncResult<unknown> {
      if (disposed || transitions) return err(PluginInactive({ pluginId }));
      const generation = epoch;
      const available = await this.tools(signal);
      if (!available.ok) return available;
      const tool = available.value.find((item) => item.name === input.toolName);
      if (!tool) return err(PluginAccessDenied({ pluginId }));
      if (tool.sideEffect !== input.mode) return err(PluginAccessDenied({ pluginId }));
      if (input.mode === 'external' && !input.idempotencyKey) return err(PluginInvalidInput({ pluginId }));
      const valid = await validator.validate(input.toolName, input.input);
      if (!valid.ok) return valid;
      const stored = await credentials();
      if (!stored.ok) return stored;
      if (!(await deps.networkAllowed())) return err(PluginAccessDenied({ pluginId }));
      if (generation !== epoch) return err(CancelledError());
      if (input.idempotencyKey && input.mode === 'external') {
        const reserved = await ledger.reserve(input.idempotencyKey, {
          name: input.toolName,
          input: input.input,
        });
        if (!reserved.ok) return reserved;
        if (!reserved.value.fresh) return ok(reserved.value.value);
      }
      if (generation !== epoch) return err(CancelledError());
      const active = adapter;
      if (!active) return err(PluginInactive({ pluginId }));
      const combined = signalFor(signal);
      const result = await pluginAttempt(pluginId, combined, () =>
        active.invoke(input.toolName, input.input, combined),
      );
      const safe = redactPluginValue(result, stored.value.values);
      if (generation !== epoch) return err(CancelledError());
      if (safe.ok && input.idempotencyKey && input.mode === 'external') {
        const saved = await ledger.finish(input.idempotencyKey, safe.value);
        if (!saved.ok) return saved;
      }
      return safe;
    },
    suspendNetwork: stop,
    async dispose() {
      disposed = true;
      await stop();
    },
  };
}
