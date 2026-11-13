// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `templates` tool module for the agent process (SPEC "Agent tools").
 * The Analyst uses the intake and finalise tools, the Librarian
 * templates.planFromFormat, and the breakdown card's buttons the slot edits.
 */
import { defineToolModule, type ToolModule } from '@taalcut/core';
import { createDraftCache, type TemplateToolDeps } from './deps';
import { slotEditTools } from './edit-tools';
import { fetchMediaTool } from './fetch-media';
import { finaliseTool, judgeCutTool, resolveCutsTool } from './finalise-tools';
import { listInstagramCollectionsTool, listInstagramSavedReelsTool } from './instagram-tools';
import { setIntentsTool } from './intent-tools';
import { abandonBreakdownTool, breakdownTool, fetchReferenceTool, referenceStatusTool } from './intake-tools';
import { getTool, listTool, planFromFormatTool, searchTools } from './library-tools';
import { styleProfileTools } from './style-profile-tools';

export const TEMPLATES_TOOL_MODULE_ID = 'templates';

export function templatesToolModule(deps: TemplateToolDeps): ToolModule {
  const drafts = createDraftCache(deps.sandbox);
  return defineToolModule({
    id: TEMPLATES_TOOL_MODULE_ID,
    tools: [
      fetchReferenceTool(deps),
      breakdownTool(deps, drafts),
      judgeCutTool(deps, drafts),
      resolveCutsTool(deps, drafts),
      setIntentsTool(deps, drafts),
      finaliseTool(deps, drafts),
      abandonBreakdownTool(deps, drafts),
      referenceStatusTool(deps, drafts),
      // REF1: an older template fetches its reel again. Offered everywhere, so every composition offers one
      // catalogue (recorded sessions match on it); without a media store it answers core.not_implemented.
      fetchMediaTool(deps),
      planFromFormatTool(deps),
      listTool(deps),
      getTool(deps),
      ...searchTools(deps.search),
      ...styleProfileTools(deps.styleProfiles),
      listInstagramCollectionsTool(deps),
      listInstagramSavedReelsTool(deps),
      ...slotEditTools(),
    ],
  });
}
