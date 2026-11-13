// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { fromJsonSchema, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { err, ok, type PluginTool } from '@taalcut/core';
import { PluginInvalidInput, PluginInvalidTool } from './errors';

/** Compile once per connection. An adapter cannot accidentally skip its public schema. */
export function createPluginInputValidator(pluginId: string) {
  const schemas = new Map<string, StandardSchemaWithJSON>();
  return {
    register(tools: readonly PluginTool[]) {
      const next = new Map<string, StandardSchemaWithJSON>();
      try {
        for (const tool of tools) next.set(tool.name, fromJsonSchema(tool.inputSchema));
      } catch {
        return err(PluginInvalidTool({ pluginId }));
      }
      schemas.clear();
      for (const [name, schema] of next) schemas.set(name, schema);
      return ok(undefined);
    },
    async validate(name: string, input: Record<string, unknown>) {
      const schema = schemas.get(name);
      if (!schema) return err(PluginInvalidTool({ pluginId }));
      try {
        const result = await schema['~standard'].validate(input);
        return result.issues ? err(PluginInvalidInput({ pluginId })) : ok(undefined);
      } catch {
        return err(PluginInvalidInput({ pluginId }));
      }
    },
    clear: () => schemas.clear(),
  };
}
