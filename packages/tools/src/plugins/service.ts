// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  ok,
  pluginManifestSchema,
  pluginSkillContentSchema,
  type PluginService,
  type PluginSecrets,
  type SettingsStore,
} from '@taalcut/core';
import { PluginNotFound } from './errors';
import { createPluginInstance } from './instance';
import type { PluginDefinition } from './provider';

export interface PluginServiceDeps {
  readonly definitions: readonly PluginDefinition[];
  readonly settings: SettingsStore;
  readonly secrets: PluginSecrets;
  readonly networkAllowed: () => Promise<boolean>;
  readonly now?: () => number;
}

export function createPluginService(deps: PluginServiceDeps): PluginService {
  const instances = new Map<string, ReturnType<typeof createPluginInstance>>();
  for (const definition of deps.definitions) {
    const manifest = pluginManifestSchema.parse(definition.manifest);
    if (instances.has(manifest.id)) throw new Error(`Duplicate plugin '${manifest.id}'.`);
    const skillIds = definition.skills.map((skill) => pluginSkillContentSchema.parse(skill).id);
    if (
      new Set(skillIds).size !== skillIds.length ||
      manifest.skills.some((skill) => !skillIds.includes(skill.id))
    ) {
      throw new Error(`Invalid skill contributions for plugin '${manifest.id}'.`);
    }
    for (const group of [manifest.access, manifest.credentials, manifest.configFields]) {
      if (new Set(group.map((item) => item.id)).size !== group.length)
        throw new Error(`Duplicate plugin field '${manifest.id}'.`);
    }
    instances.set(
      manifest.id,
      createPluginInstance(
        { ...definition, manifest, skills: structuredClone(definition.skills) },
        { ...deps, now: deps.now ?? Date.now },
      ),
    );
  }
  const unknown = (pluginId: string) => Promise.resolve(err(PluginNotFound({ pluginId })));
  return {
    async list() {
      const views = await Promise.all([...instances.values()].map((instance) => instance.describe()));
      const failed = views.find((view) => !view.ok);
      if (failed && !failed.ok) return failed;
      return ok(views.flatMap((view) => (view.ok ? [view.value] : [])));
    },
    describe: (id) => instances.get(id)?.describe() ?? unknown(id),
    tools: (id, signal) => instances.get(id)?.tools(signal) ?? unknown(id),
    readSkill: (id, skill) => instances.get(id)?.readSkill(skill) ?? unknown(id),
    configure: ({ pluginId, config }) => instances.get(pluginId)?.configure(config) ?? unknown(pluginId),
    setEnabled: ({ pluginId, enabled }) => instances.get(pluginId)?.setEnabled(enabled) ?? unknown(pluginId),
    setAccess: ({ pluginId, access }) => instances.get(pluginId)?.setAccess(access) ?? unknown(pluginId),
    disconnect: (id) => instances.get(id)?.disconnect() ?? unknown(id),
    requestSetup: (id) => instances.get(id)?.requestSetup() ?? unknown(id),
    testConnection: (id, signal) => instances.get(id)?.testConnection(signal) ?? unknown(id),
    importCredential: (id, field, value) => instances.get(id)?.importCredential(field, value) ?? unknown(id),
    invoke: (input, signal) =>
      instances.get(input.pluginId)?.invoke(input, signal) ?? unknown(input.pluginId),
    async suspendNetwork() {
      await Promise.all([...instances.values()].map((instance) => instance.suspendNetwork()));
    },
    async dispose() {
      await Promise.all([...instances.values()].map((instance) => instance.dispose()));
    },
  };
}
