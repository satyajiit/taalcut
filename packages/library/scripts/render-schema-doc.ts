// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Renders SCHEMA.md from the migrations, by migrating an in-memory database
 * and reading SQLite's own catalogue, so the document can't drift from the
 * real schema. Formatted with the repo's Prettier config, so `pnpm format`
 * leaves it unchanged. Run `pnpm --filter @taalcut/library schema:doc`.
 */
import { fileURLToPath } from 'node:url';
import { unwrap } from '@taalcut/core';
import { format, resolveConfig } from 'prettier';
import { openDatabase, type SqliteDriver, type SqlRow } from '../src/index';

export const SCHEMA_DOC_PATH = fileURLToPath(new URL('../SCHEMA.md', import.meta.url));

const ABOUT: Record<string, string> = {
  projects: 'A video project (PRD 6.3).',
  conversations: 'A chat thread, inside a project or outside any. Archived and deleted softly (undoable).',
  chat_cards:
    'The latest payload of each card a conversation shows, by card id; messages refer to cards by id.',
  messages: 'One chat message; `content` holds parts, cards and artifact references as JSON.',
  tool_runs: 'One agent tool call, for tool-run cards and the trace.',
  commands:
    "The command bus audit log (PRD V2, core's AuditEntry): one row per dispatched command, numbered per project; idempotency keys are unique across the log.",
  agent_events: "The agent's append-only run log (PRD 7.2), gap-free per run.",
  agent_runs: 'One summary row per agent run (status, last seq), written with its events.',
  jobs: "The durable job queue (PRD G7): leases for the engine, and core's JobRecord. An idempotency key belongs to at most one live job.",
  settings: 'Settings as JSON values by key. Never secrets.',
  model_profile_state: 'The model-profile document (PRD 8.4), opaque JSON owned by @taalcut/models. One row.',
  acknowledgements: 'Warning-card and gated-feature acknowledgements with terms version and time (PRD 10.1).',
  cloud_calls: "One row per outbound model call (PRD G9, core's CloudCallRecord), shown in Settings → Usage.",
  sources:
    '**Provisional** (ADR 0001, awaiting D4 approval): a watched-folder root or a phone import session, identified by root path plus APFS Volume UUID.',
  assets:
    '**Provisional** (ADR 0001): one row per distinct BLAKE3. `availability` is derived by triggers from the locations: any `present` → online; else any `icloud_placeholder`; else any `offline`; else missing.',
  asset_locations:
    "**Provisional** (ADR 0001): one row per place an asset's bytes live; at most one managed copy per asset.",
  shots: '**Provisional** (ADR 0001): shot timing within an asset, as integer RationalTime.',
  artifacts:
    'Large tool outputs kept by reference: metadata only; the bytes are files named by `content_hash` (redacted when text).',
  trace_runs: 'Agent runs as the developer trace viewer lists them (P1-G5); the newest 500 are kept.',
  trace_spans: 'Spans of a traced run; token and cost numbers as columns, other attributes as redacted JSON.',
  vector_indexes: 'Registry of vector indexes; each owns a `vec_<name>` sqlite-vec table created at runtime.',
  transcripts:
    "An asset's transcript (core's Transcript, word timings included) and its plain text for search and previews.",
  derived_files:
    'Files media derived from an asset (proxies, thumbnails, filmstrips, waveforms, stills), by key under the media cache root; never a path.',
  asset_index_stages:
    "The indexing pipeline's state (P2-L13): one row per asset and stage, with its job, priority, boost, stored output and error.",
  shot_search_rows: 'A stable integer key per shot for `shot_fts`; written by triggers only.',
  templates: 'A template lineage (P2-T8): name, project, listing, archive and its head version.',
  template_versions:
    'Immutable template versions: the Template as JSON, its parent and change key, and summary columns read from it.',
  template_assets: 'Content-addressed template assets (contact sheets); the bytes are files named by sha256.',
  template_fts: "FTS5 over each lineage's head: name, slot intents, overlay text.",
  timelines: "A timeline's working copy (core's Timeline as JSON), its revision and summary columns.",
  timeline_versions: 'Saved timeline snapshots (auto, named, before-restore, export), numbered per timeline.',
  timeline_asset_refs: "Assets a timeline's clips use; RESTRICT keeps a used asset from being collected.",
  renders: 'One row per RenderRecord; the file path and full QA report never reach a window.',
  telemetry_outbox: 'Queued telemetry envelopes (at most 5,000), checked on append and on take.',
  shot_fts:
    'FTS5 over each shot: description, labels, on-screen text, transcript and file name. Triggers on `shots` and `assets` keep it in step; the tokenizer keeps Devanagari marks inside words.',
  trips:
    "LIB1-PLACE: the library's clips grouped by capture time and place (derived; only `name` is the person's).",
  asset_places:
    "LIB1-PLACE: each asset's place in words (its own GPS city, a neighbour's, or a time-zone hint), its trip, and the place and trip words its shots' FTS labels carry.",
  workspace_revisions:
    "HFW1-WS: one revision of a project's HyperFrames workspace (core's WorkspaceRevision): its files by path and sha256, never their bytes, which are blobs under `workspaces/<projectId>/blobs/`.",
  workspace_heads: "HFW1-WS: the revision each project's workspace is at (0: empty); `workspace.restore` moves it.",
  _migrations: 'Applied migrations, with checksums. Managed by the migration runner.',
};

function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function tableSection(driver: SqliteDriver, table: SqlRow): string {
  const name = String(table.name);
  const columns = driver.prepare(`PRAGMA table_xinfo(${name})`).all();
  const foreign = driver.prepare(`PRAGMA foreign_key_list(${name})`).all();
  const indexes = driver
    .prepare(`PRAGMA index_list(${name})`)
    .all()
    .filter((i) => i.origin !== 'pk');
  const fkByColumn = new Map(
    foreign.map((f) => [
      String(f.from),
      `→ ${f.table}(${f.to}) on delete ${String(f.on_delete).toLowerCase()}`,
    ]),
  );
  const lines = [`## ${name}`, '', ABOUT[name] ?? '', ''];
  lines.push('| Column | Type | Null | Default | Key |', '| --- | --- | --- | --- | --- |');
  for (const c of columns) {
    const pk = Number(c.pk) > 0;
    const key = [pk ? 'PK' : '', fkByColumn.get(String(c.name)) ?? ''].filter(Boolean).join(' ');
    // An INTEGER PRIMARY KEY is the rowid and can't be null even without NOT NULL.
    const nullable = c.notnull === 1 || (pk && c.type === 'INTEGER') ? 'no' : 'yes';
    lines.push(
      `| \`${cell(c.name)}\` | ${cell(c.type)} | ${nullable} | ${cell(c.dflt_value)} | ${cell(key)} |`,
    );
  }
  const triggers = driver
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ? ORDER BY name")
    .all(name);
  if (triggers.length > 0) {
    lines.push('', 'Triggers:', '', ...triggers.map((t) => `- \`${String(t.name)}\``));
  }
  if (indexes.length > 0) {
    lines.push('', 'Indexes:', '');
    for (const index of indexes) {
      const indexName = String(index.name);
      const sql = driver
        .prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?")
        .get(indexName);
      const definition = sql?.sql ? String(sql.sql).replace(/^CREATE (UNIQUE )?INDEX \S+ ON \w+\s*/, '') : '';
      lines.push(`- \`${indexName}\`${index.unique === 1 ? ' (unique)' : ''} ${definition}`.trimEnd());
    }
  }
  lines.push('', '```sql', String(table.sql), '```', '');
  return lines.join('\n');
}

/** The full SCHEMA.md text for the latest migration. */
export async function renderSchemaDoc(): Promise<string> {
  const options = (await resolveConfig(SCHEMA_DOC_PATH)) ?? {};
  return format(renderRaw(), { ...options, parser: 'markdown' });
}

function renderRaw(): string {
  const db = unwrap(openDatabase({ path: ':memory:' }));
  try {
    const all = db.driver
      .prepare(
        "SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    // An FTS5 table's shadow tables (<name>_data, _idx, …) are SQLite's own: listed under it, not apart.
    const virtual = all
      .filter((t) => String(t.sql).startsWith('CREATE VIRTUAL TABLE'))
      .map((t) => String(t.name));
    const tables = all.filter((t) => !virtual.some((v) => String(t.name).startsWith(`${v}_`)));
    const header = [
      '# Library database schema',
      '',
      `Generated from the migrations (schema version ${db.schemaVersion()}) by`,
      '`pnpm --filter @taalcut/library schema:doc`. Do not edit by hand; a test fails when it is stale.',
      '',
      'Times are integer milliseconds since the epoch. Ids are ULIDs. JSON columns are TEXT checked',
      'with `json_valid`. Tables are STRICT. Vector tables (`vec_<name>`, sqlite-vec `vec0`) are',
      'created at runtime by the vector index and are not listed here; see SPEC.md.',
      '',
      ...tables.map((t) => `- [${t.name}](#${String(t.name).replace(/^_/, '')})`),
      '',
    ];
    return [...header, ...tables.map((t) => tableSection(db.driver, t))].join('\n');
  } finally {
    db.close();
  }
}
