// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Existing plugin policy remains the boundary for discovery and external operations. */
export const EDITOR_PLUGIN_TOOLS = [
  'plugins.list',
  'plugins.describe',
  'plugins.listTools',
  'plugins.readSkill',
  'plugins.callExternal',
] as const;

export const EDITOR_EDITS_PROMPT = `Instagram Edits: read workspace.docs topic taalcut/edit-edits and the plugin's skill/schema first. Respect access/approval rules. Explicit requests require export plus staging that exact ready render (or verified ready render for staging alone); claim Edits only after staged:true. Staging never authorizes Share to Instagram, publication or scheduling. Report unavailable/declined/failed staging visibly and in handOff.notStagedReason.`;
