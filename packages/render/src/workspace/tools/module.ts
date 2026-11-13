// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `workspace` tool module (HFW1 "dsn", render SPEC "HFW1: the Designer's workspace"): a project's HyperFrames
 * workspace for the Designer. It lists, reads and writes files (a blank scaffold to start from), gates a
 * composition and draws stills of it, places it on the timeline as a proposal or as a new version of placed
 * graphics, keeps it in the template, and reads HyperFrames' own docs. No tool brings an old graphic in: graphics
 * made before HFW1 are deleted, not converted.
 */
import { defineToolModule, type ToolModule } from '@taalcut/core';
import { workspaceCheckTools, type WorkspaceLooks } from './check-tools';
import type { WorkspaceToolDeps } from './deps';
import { workspaceDocsTool } from './docs-tool';
import { workspaceFileTools } from './file-tools';
import { workspacePlaceTools } from './place-tools';
import { workspacePromoteTool } from './promote-tool';

/** Every tool the module offers, by name (the Designer's skill names them). */
export const WORKSPACE_TOOLS = [
  'workspace.list',
  'workspace.read',
  'workspace.new',
  'workspace.write',
  'workspace.patch',
  'workspace.lint',
  'workspace.render',
  'workspace.renderOver',
  'workspace.place',
  'workspace.replace',
  'workspace.promote',
  'workspace.docs',
] as const;

/** First-class workspace file management and search tools added alongside the base Designer workspace tools. */
export const WORKSPACE_EXTRA_TOOLS = [
  'workspace.delete',
  'workspace.move',
  'workspace.search',
] as const;

export function workspaceToolModule(deps: WorkspaceToolDeps): ToolModule {
  // A render's stills and its count, which place, replace and the next render read.
  const looks: WorkspaceLooks = { posters: new Map(), renders: new Map() };
  const files = workspaceFileTools(deps);
  const checks = workspaceCheckTools(deps, looks);
  const placing = workspacePlaceTools(deps, looks);
  return defineToolModule({
    id: 'workspace',
    tools: [
      files.list,
      files.read,
      files.create,
      files.write,
      files.patch,
      files.delete,
      files.move,
      files.search,
      checks.lint,
      checks.render,
      checks.renderOver,
      placing.place,
      placing.replace,
      workspacePromoteTool(deps),
      workspaceDocsTool(),
    ],
  });
}
