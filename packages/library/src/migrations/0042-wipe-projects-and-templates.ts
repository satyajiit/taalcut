// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-TPL: projects and templates made before HyperFrames compositions are wiped, not carried forward (the owner:
 * "Old projects - stop writing fallbacks for them. we can wipe them. we are still in dev"). Gone: every project with
 * its timelines, saved versions, asset links, comments, commands (and their history steps), renders, chats and the
 * memory scoped to it, its Style choice and workspace; every template with its versions, kept reel, search row,
 * contact sheets, hub submissions and the memory scoped to it. Kept: assets, shots and their analysis, sources,
 * memory not tied to a project or template, Styles, template folders, Instagram saves, chats outside a project,
 * settings, and the cloud-call, job and generated-asset history with their project cleared, as ON DELETE SET NULL
 * would. Jobs a wiped project had queued, running or paused go: their work is gone.
 *
 * Foreign keys are off while a migration runs (runner.ts), so each ON DELETE rule is done here by hand, children
 * first; the runner's foreign_key_check before commit proves none was missed. Opening the library backs it up first
 * (`pre-migrate-to-v42`, db/open.ts), which is what `down` would need: it brings nothing back. The files go with the
 * stores' prunes: a gone project's workspace folder whole, a kept reel's folder, a contact sheet with no row.
 */
import type { Migration } from './types';

const PROJECT_CHATS = 'SELECT id FROM conversations WHERE project_id IS NOT NULL';

const up = `
DELETE FROM tool_runs WHERE conversation_id IN (${PROJECT_CHATS});
DELETE FROM chat_cards WHERE conversation_id IN (${PROJECT_CHATS});
DELETE FROM messages WHERE conversation_id IN (${PROJECT_CHATS});
UPDATE agent_runs SET conversation_id = NULL WHERE conversation_id IN (${PROJECT_CHATS});
UPDATE trace_runs SET conversation_id = NULL WHERE conversation_id IN (${PROJECT_CHATS});
DELETE FROM memory_items WHERE project_id IS NOT NULL OR template_id IS NOT NULL;
UPDATE memory_items SET conversation_id = NULL WHERE conversation_id IN (${PROJECT_CHATS});
DELETE FROM conversations WHERE project_id IS NOT NULL;
UPDATE tool_runs SET message_id = NULL
  WHERE message_id IS NOT NULL AND message_id NOT IN (SELECT id FROM messages);

DELETE FROM timeline_comments;
DELETE FROM timeline_versions;
DELETE FROM timeline_asset_refs;
DELETE FROM timelines;
DELETE FROM renders;
DELETE FROM commands WHERE project_id IS NOT NULL;
DELETE FROM project_styles;
DELETE FROM workspace_revisions;
DELETE FROM workspace_heads;
DELETE FROM jobs WHERE project_id IS NOT NULL AND state IN ('queued', 'running', 'paused');
UPDATE jobs SET project_id = NULL WHERE project_id IS NOT NULL;
UPDATE cloud_calls SET project_id = NULL WHERE project_id IS NOT NULL;
UPDATE generated_assets SET project_id = NULL WHERE project_id IS NOT NULL;

DELETE FROM template_fts;
DELETE FROM template_media;
DELETE FROM template_versions;
DELETE FROM template_assets;
DELETE FROM hub_submissions;
UPDATE instagram_saved_reels SET template_id = NULL WHERE template_id IS NOT NULL;
DELETE FROM templates;
DELETE FROM projects;
`;

/** The rows are gone; the pre-migration backup holds them. */
const down = `SELECT 1;`;

export const wipeProjectsAndTemplates: Migration = {
  version: 42,
  name: 'wipe_projects_and_templates',
  up,
  down,
};
