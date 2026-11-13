# Library database schema

Generated from the migrations (schema version 49) by
`pnpm --filter @taalcut/library schema:doc`. Do not edit by hand; a test fails when it is stale.

Times are integer milliseconds since the epoch. Ids are ULIDs. JSON columns are TEXT checked
with `json_valid`. Tables are STRICT. Vector tables (`vec_<name>`, sqlite-vec `vec0`) are
created at runtime by the vector index and are not listed here; see SPEC.md.

- [_migrations](#migrations)
- [acknowledgements](#acknowledgements)
- [agent_events](#agent_events)
- [agent_runs](#agent_runs)
- [artifacts](#artifacts)
- [asset_borrowed_offsets](#asset_borrowed_offsets)
- [asset_index_stages](#asset_index_stages)
- [asset_index_state](#asset_index_state)
- [asset_licences](#asset_licences)
- [asset_locations](#asset_locations)
- [asset_places](#asset_places)
- [asset_spoken_language](#asset_spoken_language)
- [assets](#assets)
- [authored_programs](#authored_programs)
- [capture_archives](#capture_archives)
- [capture_assets](#capture_assets)
- [chat_cards](#chat_cards)
- [cloud_calls](#cloud_calls)
- [commands](#commands)
- [conversations](#conversations)
- [creation_projects](#creation_projects)
- [derived_files](#derived_files)
- [generated_assets](#generated_assets)
- [hub_index_cache](#hub_index_cache)
- [hub_ratings_cache](#hub_ratings_cache)
- [hub_submissions](#hub_submissions)
- [import_capture_locks](#import_capture_locks)
- [import_draft_items](#import_draft_items)
- [import_drafts](#import_drafts)
- [import_provenance](#import_provenance)
- [import_session_items](#import_session_items)
- [import_sessions](#import_sessions)
- [import_source_scopes](#import_source_scopes)
- [import_space_reservations](#import_space_reservations)
- [import_volume_barriers](#import_volume_barriers)
- [import_volume_readers](#import_volume_readers)
- [index_stages](#index_stages)
- [instagram_collections](#instagram_collections)
- [instagram_saved_reels](#instagram_saved_reels)
- [jobs](#jobs)
- [local_import_receipts](#local_import_receipts)
- [memory_fts](#memory_fts)
- [memory_items](#memory_items)
- [messages](#messages)
- [model_profile_state](#model_profile_state)
- [photos_imports](#photos_imports)
- [product_campaigns](#product_campaigns)
- [product_ideas](#product_ideas)
- [product_knowledge](#product_knowledge)
- [product_knowledge_fts](#product_knowledge_fts)
- [product_notifications](#product_notifications)
- [product_occurrences](#product_occurrences)
- [product_publications](#product_publications)
- [product_publish_reconcile_cursor](#product_publish_reconcile_cursor)
- [product_schedules](#product_schedules)
- [products](#products)
- [project_styles](#project_styles)
- [projects](#projects)
- [renders](#renders)
- [settings](#settings)
- [shorts_analysis_cache](#shorts_analysis_cache)
- [shorts_runs](#shorts_runs)
- [shot_actions](#shot_actions)
- [shot_fts](#shot_fts)
- [shot_search_rows](#shot_search_rows)
- [shots](#shots)
- [sources](#sources)
- [stock_search_cache](#stock_search_cache)
- [style_assets](#style_assets)
- [style_profiles](#style_profiles)
- [styles](#styles)
- [telemetry_outbox](#telemetry_outbox)
- [template_assets](#template_assets)
- [template_folders](#template_folders)
- [template_fts](#template_fts)
- [template_media](#template_media)
- [template_versions](#template_versions)
- [templates](#templates)
- [timeline_asset_refs](#timeline_asset_refs)
- [timeline_comments](#timeline_comments)
- [timeline_versions](#timeline_versions)
- [timelines](#timelines)
- [tool_runs](#tool_runs)
- [trace_runs](#trace_runs)
- [trace_spans](#trace_spans)
- [transcripts](#transcripts)
- [trips](#trips)
- [usb_imports](#usb_imports)
- [vector_indexes](#vector_indexes)
- [voice_consents](#voice_consents)
- [workspace_heads](#workspace_heads)
- [workspace_revisions](#workspace_revisions)

## _migrations

Applied migrations, with checksums. Managed by the migration runner.

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `version`    | INTEGER | no   |         | PK  |
| `name`       | TEXT    | no   |         |     |
| `checksum`   | TEXT    | no   |         |     |
| `applied_at` | INTEGER | no   |         |     |

```sql
CREATE TABLE _migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)
```

## acknowledgements

Warning-card and gated-feature acknowledgements with terms version and time (PRD 10.1).

| Column            | Type    | Null | Default | Key |
| ----------------- | ------- | ---- | ------- | --- |
| `id`              | TEXT    | no   |         | PK  |
| `feature_id`      | TEXT    | no   |         |     |
| `terms_version`   | TEXT    | no   |         |     |
| `acknowledged_at` | INTEGER | no   |         |     |
| `context`         | TEXT    | yes  |         |     |

Indexes:

- `acknowledgements_feature_terms_uq` (unique) (feature_id, terms_version)

```sql
CREATE TABLE acknowledgements (
  id TEXT PRIMARY KEY NOT NULL,
  feature_id TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  acknowledged_at INTEGER NOT NULL,
  context TEXT CHECK (context IS NULL OR json_valid(context))
) STRICT
```

## agent_events

The agent's append-only run log (PRD 7.2), gap-free per run.

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `run_id`     | TEXT    | no   |         | PK  |
| `seq`        | INTEGER | no   |         | PK  |
| `type`       | TEXT    | no   |         |     |
| `payload`    | TEXT    | no   |         |     |
| `created_at` | INTEGER | no   |         |     |

```sql
CREATE TABLE agent_events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  type TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
) STRICT
```

## agent_runs

One summary row per agent run (status, last seq), written with its events.

| Column            | Type    | Null | Default | Key                                    |
| ----------------- | ------- | ---- | ------- | -------------------------------------- |
| `run_id`          | TEXT    | no   |         | PK                                     |
| `conversation_id` | TEXT    | yes  |         | → conversations(id) on delete set null |
| `status`          | TEXT    | no   |         |                                        |
| `last_seq`        | INTEGER | no   |         |                                        |
| `started_at`      | INTEGER | no   |         |                                        |
| `updated_at`      | INTEGER | no   |         |                                        |

Indexes:

- `agent_runs_conversation_idx` (conversation_id, updated_at)
- `agent_runs_status_idx` (status, updated_at)

```sql
CREATE TABLE agent_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'succeeded', 'failed', 'cancelled')),
  last_seq INTEGER NOT NULL CHECK (last_seq >= 0),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT
```

## artifacts

Large tool outputs kept by reference: metadata only; the bytes are files named by `content_hash` (redacted when text).

| Column         | Type    | Null | Default | Key |
| -------------- | ------- | ---- | ------- | --- |
| `id`           | TEXT    | no   |         | PK  |
| `content_hash` | TEXT    | no   |         |     |
| `media_type`   | TEXT    | no   |         |     |
| `bytes`        | INTEGER | no   |         |     |
| `summary`      | TEXT    | no   |         |     |
| `created_at`   | INTEGER | no   |         |     |
| `last_used_at` | INTEGER | no   |         |     |

Indexes:

- `artifacts_last_used_idx` (last_used_at)
- `artifacts_hash_idx` (content_hash)

```sql
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  media_type TEXT NOT NULL CHECK (length(media_type) BETWEEN 3 AND 255),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
) STRICT
```

## asset_borrowed_offsets

| Column       | Type    | Null | Default | Key                               |
| ------------ | ------- | ---- | ------- | --------------------------------- |
| `asset_id`   | TEXT    | no   |         | PK → assets(id) on delete cascade |
| `offset_min` | INTEGER | no   |         |                                   |
| `lender_id`  | TEXT    | no   |         | → assets(id) on delete cascade    |

Indexes:

- `asset_borrowed_offsets_lender_idx` (lender_id)

```sql
CREATE TABLE asset_borrowed_offsets (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  offset_min INTEGER NOT NULL CHECK (offset_min BETWEEN -720 AND 840),
  lender_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE
) STRICT
```

## asset_index_stages

The indexing pipeline's state (P2-L13): one row per asset and stage, with its job, priority, boost, stored output and error.

| Column          | Type    | Null | Default | Key                               |
| --------------- | ------- | ---- | ------- | --------------------------------- |
| `asset_id`      | TEXT    | no   |         | PK → assets(id) on delete cascade |
| `stage`         | TEXT    | no   |         | PK                                |
| `state`         | TEXT    | no   |         |                                   |
| `version`       | INTEGER | no   | 0       |                                   |
| `generation`    | INTEGER | no   | 0       |                                   |
| `job_id`        | TEXT    | yes  |         |                                   |
| `priority`      | INTEGER | no   | 0       |                                   |
| `boosted_until` | INTEGER | yes  |         |                                   |
| `output`        | TEXT    | yes  |         |                                   |
| `reason_key`    | TEXT    | yes  |         |                                   |
| `error`         | TEXT    | yes  |         |                                   |
| `attempts`      | INTEGER | no   | 0       |                                   |
| `started_at`    | INTEGER | yes  |         |                                   |
| `finished_at`   | INTEGER | yes  |         |                                   |
| `updated_at`    | INTEGER | no   |         |                                   |
| `output_digest` | TEXT    | yes  |         |                                   |

Indexes:

- `asset_index_stages_updated_idx` (updated_at)
- `asset_index_stages_job_idx` (job_id) WHERE job_id IS NOT NULL
- `asset_index_stages_stage_idx` (stage, state)
- `asset_index_stages_state_idx` (state, priority, updated_at)

```sql
CREATE TABLE asset_index_stages (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'queued', 'running', 'done', 'skipped', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  job_id TEXT,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (-1, 0, 1)),
  boosted_until INTEGER,
  output TEXT CHECK (output IS NULL OR (json_valid(output) AND length(output) <= 1048576)),
  reason_key TEXT,
  error TEXT CHECK (error IS NULL OR json_valid(error)),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL, output_digest TEXT,
  PRIMARY KEY (asset_id, stage)
) STRICT
```

## asset_index_state

| Column          | Type    | Null | Default | Key                               |
| --------------- | ------- | ---- | ------- | --------------------------------- |
| `asset_id`      | TEXT    | no   |         | PK → assets(id) on delete cascade |
| `searchable_at` | INTEGER | yes  |         |                                   |
| `complete_at`   | INTEGER | yes  |         |                                   |

```sql
CREATE TABLE asset_index_state (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  searchable_at INTEGER,
  complete_at INTEGER
)
```

## asset_licences

| Column              | Type    | Null | Default | Key                               |
| ------------------- | ------- | ---- | ------- | --------------------------------- |
| `asset_id`          | TEXT    | no   |         | PK → assets(id) on delete cascade |
| `source`            | TEXT    | no   |         |                                   |
| `provider_asset_id` | TEXT    | no   |         |                                   |
| `licence`           | TEXT    | no   |         |                                   |
| `raw_licence`       | TEXT    | no   |         |                                   |
| `nc_excluded`       | INTEGER | no   |         |                                   |
| `author`            | TEXT    | yes  |         |                                   |
| `author_url`        | TEXT    | yes  |         |                                   |
| `source_url`        | TEXT    | yes  |         |                                   |
| `attribution`       | TEXT    | no   |         |                                   |
| `fetched_at`        | INTEGER | no   |         |                                   |

Indexes:

- `asset_licences_provider_uq` (unique) (source, provider_asset_id)

```sql
CREATE TABLE asset_licences (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('pexels', 'freesound', 'bundled')),
  provider_asset_id TEXT NOT NULL,
  licence TEXT NOT NULL,
  raw_licence TEXT NOT NULL,
  nc_excluded INTEGER NOT NULL CHECK (nc_excluded = 1),
  author TEXT,
  author_url TEXT,
  source_url TEXT,
  attribution TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
) STRICT
```

## asset_locations

**Provisional** (ADR 0001): one row per place an asset's bytes live; at most one managed copy per asset.

| Column                 | Type    | Null | Default | Key                             |
| ---------------------- | ------- | ---- | ------- | ------------------------------- |
| `id`                   | TEXT    | no   |         | PK                              |
| `asset_id`             | TEXT    | no   |         | → assets(id) on delete cascade  |
| `source_id`            | TEXT    | no   |         | → sources(id) on delete cascade |
| `storage`              | TEXT    | no   |         |                                 |
| `relative_path`        | TEXT    | no   |         |                                 |
| `absolute_path_cached` | TEXT    | yes  |         |                                 |
| `volume_uuid`          | TEXT    | yes  |         |                                 |
| `partial_hash`         | TEXT    | yes  |         |                                 |
| `full_hash`            | TEXT    | yes  |         |                                 |
| `size_bytes`           | INTEGER | no   |         |                                 |
| `mtime_ms`             | INTEGER | yes  |         |                                 |
| `state`                | TEXT    | no   |         |                                 |
| `file_id`              | INTEGER | yes  |         |                                 |
| `first_seen_at`        | INTEGER | yes  |         |                                 |
| `last_seen_at`         | INTEGER | yes  |         |                                 |
| `missing_since`        | INTEGER | yes  |         |                                 |
| `via`                  | TEXT    | yes  |         |                                 |

Triggers:

- `asset_locations_attach_on_insert`
- `asset_locations_availability_on_delete`
- `asset_locations_availability_on_insert`
- `asset_locations_availability_on_update`

Indexes:

- `asset_locations_file_idx` (file_id) WHERE file_id IS NOT NULL
- `asset_locations_missing_idx` (size_bytes) WHERE state='missing'
- `asset_locations_partial_hash_idx` (partial_hash) WHERE partial_hash IS NOT NULL
- `asset_locations_volume_idx` (volume_uuid) WHERE volume_uuid IS NOT NULL
- `asset_locations_source_idx` (source_id,relative_path)
- `asset_locations_one_managed_uq` (unique) (asset_id) WHERE storage='managed'
- `asset_locations_path_uq` (unique) (asset_id,source_id,relative_path)

```sql
CREATE TABLE "asset_locations" (
 id TEXT PRIMARY KEY NOT NULL,
 asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
 storage TEXT NOT NULL CHECK(storage IN ('managed','referenced')),
 relative_path TEXT NOT NULL, absolute_path_cached TEXT, volume_uuid TEXT, partial_hash TEXT, full_hash TEXT,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),mtime_ms INTEGER,
 state TEXT NOT NULL CHECK(state IN ('present','offline','missing','icloud_placeholder')),
 file_id INTEGER,first_seen_at INTEGER,last_seen_at INTEGER,missing_since INTEGER,
 via TEXT CHECK(via IS NULL OR via IN ('scan','watcher','wifi','usb','relink','local','camera','photos'))
) STRICT
```

## asset_places

LIB1-PLACE: each asset's place in words (its own GPS city, a neighbour's, or a time-zone hint), its trip, and the place and trip words its shots' FTS labels carry.

| Column        | Type    | Null | Default | Key                               |
| ------------- | ------- | ---- | ------- | --------------------------------- |
| `asset_id`    | TEXT    | no   |         | PK → assets(id) on delete cascade |
| `own`         | TEXT    | yes  |         |                                   |
| `place`       | TEXT    | yes  |         |                                   |
| `basis`       | TEXT    | yes  |         |                                   |
| `country`     | TEXT    | yes  |         |                                   |
| `city_id`     | INTEGER | yes  |         |                                   |
| `trip_id`     | TEXT    | yes  |         | → trips(id) on delete set null    |
| `search_text` | TEXT    | no   | ''      |                                   |
| `updated_at`  | INTEGER | no   |         |                                   |

Triggers:

- `asset_places_fts_on_delete`
- `asset_places_fts_on_insert`
- `asset_places_fts_on_update`

Indexes:

- `asset_places_country_idx` (country, city_id) WHERE country IS NOT NULL
- `asset_places_trip_idx` (trip_id) WHERE trip_id IS NOT NULL

```sql
CREATE TABLE asset_places (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  own TEXT CHECK (own IS NULL OR json_valid(own)),
  place TEXT CHECK (place IS NULL OR json_valid(place)),
  basis TEXT CHECK (basis IS NULL OR basis IN ('gps', 'nearby', 'zone')),
  country TEXT CHECK (country IS NULL OR length(country) = 2),
  city_id INTEGER,
  trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
  search_text TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
) STRICT
```

## asset_spoken_language

| Column       | Type    | Null | Default | Key                               |
| ------------ | ------- | ---- | ------- | --------------------------------- |
| `asset_id`   | TEXT    | no   |         | PK → assets(id) on delete cascade |
| `outcome`    | TEXT    | yes  |         |                                   |
| `chosen`     | TEXT    | yes  |         |                                   |
| `chosen_at`  | INTEGER | yes  |         |                                   |
| `updated_at` | INTEGER | no   |         |                                   |

```sql
CREATE TABLE asset_spoken_language (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  outcome TEXT CHECK (outcome IS NULL OR json_valid(outcome)),
  chosen TEXT CHECK (chosen IS NULL OR length(chosen) BETWEEN 2 AND 35),
  chosen_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT
```

## assets

**Provisional** (ADR 0001): one row per distinct BLAKE3. `availability` is derived by triggers from the locations: any `present` → online; else any `icloud_placeholder`; else any `offline`; else missing.

| Column               | Type    | Null | Default               | Key |
| -------------------- | ------- | ---- | --------------------- | --- |
| `id`                 | TEXT    | no   |                       | PK  |
| `kind`               | TEXT    | no   |                       |     |
| `content_hash_alg`   | TEXT    | yes  |                       |     |
| `content_hash`       | TEXT    | yes  |                       |     |
| `partial_hash`       | TEXT    | yes  |                       |     |
| `size_bytes`         | INTEGER | no   |                       |     |
| `original_filename`  | TEXT    | no   |                       |     |
| `capture_time`       | INTEGER | yes  |                       |     |
| `width`              | INTEGER | yes  |                       |     |
| `height`             | INTEGER | yes  |                       |     |
| `rotation_degrees`   | INTEGER | yes  |                       |     |
| `duration_value`     | INTEGER | yes  |                       |     |
| `duration_rate_num`  | INTEGER | yes  |                       |     |
| `duration_rate_den`  | INTEGER | yes  |                       |     |
| `availability`       | TEXT    | no   |                       |     |
| `created_at`         | INTEGER | no   |                       |     |
| `generation`         | INTEGER | no   | 0                     |     |
| `updated_at`         | INTEGER | no   | 0                     |     |
| `facts`              | TEXT    | yes  |                       |     |
| `orientation`        | TEXT    | yes  |                       |     |
| `hdr`                | TEXT    | yes  |                       |     |
| `speed`              | TEXT    | yes  |                       |     |
| `frame_rate_num`     | INTEGER | yes  |                       |     |
| `frame_rate_den`     | INTEGER | yes  |                       |     |
| `has_audio`          | INTEGER | yes  |                       |     |
| `capture_offset_min` | INTEGER | yes  |                       |     |
| `latitude`           | REAL    | yes  |                       |     |
| `longitude`          | REAL    | yes  |                       |     |
| `device_make`        | TEXT    | yes  |                       |     |
| `device_model`       | TEXT    | yes  |                       |     |
| `live_photo_id`      | TEXT    | yes  |                       |     |
| `companion_of`       | TEXT    | yes  |                       |     |
| `language`           | TEXT    | yes  |                       |     |
| `reencode`           | TEXT    | yes  |                       |     |
| `reencode_reasons`   | TEXT    | yes  |                       |     |
| `trashed_at`         | INTEGER | yes  |                       |     |
| `detached_at`        | INTEGER | yes  |                       |     |
| `beat_map`           | TEXT    | yes  |                       |     |
| `provenance`         | TEXT    | no   | '{"kind":"captured"}' |     |

Triggers:

- `assets_availability_on_insert`
- `assets_companion_on_delete`
- `shot_fts_on_rename`

Indexes:

- `assets_detached_idx` (detached_at) WHERE detached_at IS NOT NULL
- `assets_companion_idx` (companion_of) WHERE companion_of IS NOT NULL
- `assets_live_photo_idx` (live_photo_id) WHERE live_photo_id IS NOT NULL
- `assets_created_idx` (created_at, id)
- `assets_capture_idx` (capture_time, id)
- `assets_partial_hash_idx` (partial_hash) WHERE partial_hash IS NOT NULL
- `assets_content_hash_uq` (unique) (content_hash_alg, content_hash) WHERE content_hash IS NOT NULL

```sql
CREATE TABLE "assets" (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'image', 'audio', 'live_photo')),
  content_hash_alg TEXT CHECK (content_hash_alg IS NULL OR content_hash_alg = 'blake3'),
  content_hash TEXT,
  partial_hash TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  original_filename TEXT NOT NULL,
  capture_time INTEGER,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  rotation_degrees INTEGER CHECK (rotation_degrees IS NULL OR rotation_degrees IN (0, 90, 180, 270)),
  duration_value INTEGER,
  duration_rate_num INTEGER CHECK (duration_rate_num IS NULL OR duration_rate_num > 0),
  duration_rate_den INTEGER CHECK (duration_rate_den IS NULL OR duration_rate_den > 0),
  availability TEXT NOT NULL CHECK (availability IN ('online', 'offline', 'missing', 'icloud_placeholder')),
  created_at INTEGER NOT NULL, generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0), updated_at INTEGER NOT NULL DEFAULT 0, facts TEXT CHECK (facts IS NULL OR json_valid(facts)), orientation TEXT CHECK (orientation IS NULL OR orientation IN ('portrait', 'landscape', 'square')), hdr TEXT CHECK (hdr IS NULL OR hdr IN ('none', 'hlg', 'pq', 'dolby-vision')), speed TEXT CHECK (speed IS NULL OR speed IN ('normal', 'slow-motion', 'time-lapse')), frame_rate_num INTEGER CHECK (frame_rate_num IS NULL OR frame_rate_num > 0), frame_rate_den INTEGER CHECK (frame_rate_den IS NULL OR frame_rate_den > 0), has_audio INTEGER CHECK (has_audio IS NULL OR has_audio IN (0, 1)), capture_offset_min INTEGER, latitude REAL, longitude REAL, device_make TEXT, device_model TEXT, live_photo_id TEXT, companion_of TEXT, language TEXT, reencode TEXT CHECK (reencode IS NULL OR reencode IN ('likely', 'unlikely', 'unknown')), reencode_reasons TEXT CHECK (reencode_reasons IS NULL OR json_valid(reencode_reasons)), trashed_at INTEGER, detached_at INTEGER, beat_map TEXT CHECK (beat_map IS NULL OR json_valid(beat_map)), provenance TEXT NOT NULL DEFAULT '{"kind":"captured"}'
  CHECK (json_valid(provenance)),
  CHECK ((content_hash IS NULL) = (content_hash_alg IS NULL)),
  CHECK ((duration_value IS NULL) = (duration_rate_num IS NULL)),
  CHECK ((duration_value IS NULL) = (duration_rate_den IS NULL))
) STRICT
```

## authored_programs

| Column       | Type    | Null | Default | Key                                 |
| ------------ | ------- | ---- | ------- | ----------------------------------- |
| `project_id` | TEXT    | no   |         | PK → projects(id) on delete cascade |
| `id`         | TEXT    | no   |         | PK                                  |
| `hash`       | TEXT    | no   |         | PK                                  |
| `manifest`   | TEXT    | no   |         |                                     |
| `created_at` | INTEGER | no   |         |                                     |

```sql
CREATE TABLE authored_programs (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  hash TEXT NOT NULL,
  manifest TEXT NOT NULL CHECK (json_valid(manifest)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, id, hash)
) STRICT
```

## capture_archives

| Column        | Type    | Null | Default | Key |
| ------------- | ------- | ---- | ------- | --- |
| `id`          | TEXT    | no   |         | PK  |
| `capture_key` | TEXT    | no   |         |     |
| `manifest`    | TEXT    | no   |         |     |
| `updated_at`  | INTEGER | no   |         |     |

Indexes:

- `sqlite_autoindex_capture_archives_2` (unique)

```sql
CREATE TABLE capture_archives (
  id TEXT PRIMARY KEY NOT NULL,
  capture_key TEXT NOT NULL UNIQUE,
  manifest TEXT NOT NULL CHECK (json_valid(manifest)),
  updated_at INTEGER NOT NULL
) STRICT
```

## capture_assets

| Column        | Type | Null | Default | Key                                         |
| ------------- | ---- | ---- | ------- | ------------------------------------------- |
| `capture_id`  | TEXT | no   |         | PK → capture_archives(id) on delete cascade |
| `asset_id`    | TEXT | no   |         | → assets(id) on delete cascade              |
| `member_name` | TEXT | no   |         | PK                                          |

```sql
CREATE TABLE capture_assets (
  capture_id TEXT NOT NULL REFERENCES capture_archives(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  PRIMARY KEY (capture_id, member_name)
) STRICT
```

## chat_cards

The latest payload of each card a conversation shows, by card id; messages refer to cards by id.

| Column            | Type    | Null | Default | Key                                      |
| ----------------- | ------- | ---- | ------- | ---------------------------------------- |
| `conversation_id` | TEXT    | no   |         | PK → conversations(id) on delete cascade |
| `card_id`         | TEXT    | no   |         | PK                                       |
| `run_id`          | TEXT    | yes  |         |                                          |
| `card`            | TEXT    | no   |         |                                          |
| `created_at`      | INTEGER | no   |         |                                          |
| `updated_at`      | INTEGER | no   |         |                                          |

```sql
CREATE TABLE chat_cards (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL CHECK (length(card_id) BETWEEN 1 AND 200),
  run_id TEXT,
  card TEXT NOT NULL CHECK (json_valid(card)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, card_id)
) STRICT
```

## cloud_calls

One row per outbound model call (PRD G9, core's CloudCallRecord), shown in Settings → Usage.

| Column                | Type    | Null | Default | Key                               |
| --------------------- | ------- | ---- | ------- | --------------------------------- |
| `id`                  | TEXT    | no   |         | PK                                |
| `module`              | TEXT    | no   |         |                                   |
| `provider`            | TEXT    | no   |         |                                   |
| `model`               | TEXT    | no   |         |                                   |
| `bytes_sent`          | INTEGER | no   | 0       |                                   |
| `input_tokens`        | INTEGER | no   | 0       |                                   |
| `output_tokens`       | INTEGER | no   | 0       |                                   |
| `cost_micro_usd`      | INTEGER | no   | 0       |                                   |
| `latency_ms`          | INTEGER | no   |         |                                   |
| `outcome`             | TEXT    | no   |         |                                   |
| `error_code`          | TEXT    | yes  |         |                                   |
| `run_id`              | TEXT    | yes  |         |                                   |
| `project_id`          | TEXT    | yes  |         | → projects(id) on delete set null |
| `started_at`          | INTEGER | no   |         |                                   |
| `reasoning`           | TEXT    | no   | 'off'   |                                   |
| `local`               | INTEGER | no   | 0       |                                   |
| `bytes_received`      | INTEGER | no   | 0       |                                   |
| `cached_input_tokens` | INTEGER | no   | 0       |                                   |
| `cache_write_tokens`  | INTEGER | no   | 0       |                                   |
| `http_status`         | INTEGER | yes  |         |                                   |
| `attempt`             | INTEGER | no   | 1       |                                   |
| `span_id`             | TEXT    | yes  |         |                                   |
| `billed_unit`         | TEXT    | yes  |         |                                   |
| `billed_quantity`     | REAL    | yes  |         |                                   |
| `billing`             | TEXT    | yes  |         |                                   |

Indexes:

- `cloud_calls_project_idx` (project_id, started_at)
- `cloud_calls_run_idx` (run_id)
- `cloud_calls_module_idx` (module, started_at)
- `cloud_calls_started_idx` (started_at)

```sql
CREATE TABLE cloud_calls (
  id TEXT PRIMARY KEY NOT NULL,
  module TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  bytes_sent INTEGER NOT NULL DEFAULT 0 CHECK (bytes_sent >= 0),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (cost_micro_usd >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'cancelled')),
  error_code TEXT,
  run_id TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  started_at INTEGER NOT NULL
, reasoning TEXT NOT NULL DEFAULT 'off'
  CHECK (reasoning IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')), local INTEGER NOT NULL DEFAULT 0 CHECK (local IN (0, 1)), bytes_received INTEGER NOT NULL DEFAULT 0 CHECK (bytes_received >= 0), cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0), cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0), http_status INTEGER, attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1), span_id TEXT, billed_unit TEXT
  CHECK (billed_unit IS NULL OR billed_unit IN ('token', 'character', 'second', 'image', 'credit')), billed_quantity REAL
  CHECK (billed_quantity IS NULL OR billed_quantity >= 0), billing TEXT CHECK (billing IN ('apiKey', 'subscription'))) STRICT
```

## commands

The command bus audit log (PRD V2, core's AuditEntry): one row per dispatched command, numbered per project; idempotency keys are unique across the log.

| Column            | Type    | Null | Default   | Key                              |
| ----------------- | ------- | ---- | --------- | -------------------------------- |
| `id`              | TEXT    | no   |           | PK                               |
| `project_id`      | TEXT    | yes  |           | → projects(id) on delete cascade |
| `seq`             | INTEGER | no   |           |                                  |
| `name`            | TEXT    | no   |           |                                  |
| `payload`         | TEXT    | no   |           |                                  |
| `inverse`         | TEXT    | yes  |           |                                  |
| `source`          | TEXT    | no   |           |                                  |
| `actor`           | TEXT    | no   |           |                                  |
| `side_effect`     | TEXT    | no   |           |                                  |
| `status`          | TEXT    | no   | 'applied' |                                  |
| `created_at`      | INTEGER | no   |           |                                  |
| `undone_at`       | INTEGER | yes  |           |                                  |
| `redone_at`       | INTEGER | yes  |           |                                  |
| `idempotency_key` | TEXT    | yes  |           |                                  |
| `result`          | TEXT    | yes  |           |                                  |
| `group_id`        | TEXT    | yes  |           |                                  |

Indexes:

- `commands_idempotency_key_uq` (unique) (idempotency_key) WHERE idempotency_key IS NOT NULL
- `commands_project_seq_idx` (project_id, seq)
- `commands_scope_seq_uq` (unique) (coalesce(project_id, ''), seq)

```sql
CREATE TABLE commands (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq > 0),
  name TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  inverse TEXT CHECK (inverse IS NULL OR json_valid(inverse)),
  source TEXT NOT NULL CHECK (source IN ('ui', 'shortcut', 'agent', 'mcp')),
  actor TEXT NOT NULL,
  side_effect TEXT NOT NULL CHECK (side_effect IN ('read', 'write', 'destructive', 'external')),
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'undone', 'redone')),
  created_at INTEGER NOT NULL,
  undone_at INTEGER,
  redone_at INTEGER
, idempotency_key TEXT
  CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 512), result TEXT CHECK (result IS NULL OR json_valid(result)), group_id TEXT CHECK (group_id IS NULL OR length(group_id) BETWEEN 1 AND 200)) STRICT
```

## conversations

A chat thread, inside a project or outside any. Archived and deleted softly (undoable).

| Column        | Type    | Null | Default | Key                              |
| ------------- | ------- | ---- | ------- | -------------------------------- |
| `id`          | TEXT    | no   |         | PK                               |
| `project_id`  | TEXT    | yes  |         | → projects(id) on delete cascade |
| `title`       | TEXT    | yes  |         |                                  |
| `created_at`  | INTEGER | no   |         |                                  |
| `updated_at`  | INTEGER | no   |         |                                  |
| `archived_at` | INTEGER | yes  |         |                                  |
| `deleted_at`  | INTEGER | yes  |         |                                  |

Indexes:

- `conversations_recent_idx` (updated_at)
- `conversations_project_idx` (project_id, updated_at)

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, archived_at INTEGER, deleted_at INTEGER) STRICT
```

## creation_projects

| Column       | Type    | Null | Default | Key                                 |
| ------------ | ------- | ---- | ------- | ----------------------------------- |
| `project_id` | TEXT    | no   |         | PK → projects(id) on delete cascade |
| `revision`   | INTEGER | no   |         |                                     |
| `state`      | TEXT    | no   |         |                                     |
| `updated_at` | INTEGER | no   |         |                                     |

```sql
CREATE TABLE creation_projects (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL CHECK (json_valid(state)),
  updated_at INTEGER NOT NULL
) STRICT
```

## derived_files

Files media derived from an asset (proxies, thumbnails, filmstrips, waveforms, stills), by key under the media cache root; never a path.

| Column              | Type    | Null | Default | Key                            |
| ------------------- | ------- | ---- | ------- | ------------------------------ |
| `key`               | TEXT    | no   |         | PK                             |
| `asset_id`          | TEXT    | no   |         | → assets(id) on delete cascade |
| `shot_id`           | TEXT    | yes  |         | → shots(id) on delete cascade  |
| `kind`              | TEXT    | no   |         |                                |
| `bytes`             | INTEGER | no   |         |                                |
| `mime_type`         | TEXT    | no   |         |                                |
| `width`             | INTEGER | yes  |         |                                |
| `height`            | INTEGER | yes  |         |                                |
| `duration_value`    | INTEGER | yes  |         |                                |
| `duration_rate_num` | INTEGER | yes  |         |                                |
| `duration_rate_den` | INTEGER | yes  |         |                                |
| `frame_rate_num`    | INTEGER | yes  |         |                                |
| `frame_rate_den`    | INTEGER | yes  |         |                                |
| `recipe`            | INTEGER | no   |         |                                |
| `created_at`        | INTEGER | no   |         |                                |

Indexes:

- `derived_files_shot_idx` (shot_id) WHERE shot_id IS NOT NULL
- `derived_files_asset_idx` (asset_id, kind)

```sql
CREATE TABLE derived_files (
  key TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  shot_id TEXT REFERENCES shots(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('proxy', 'thumbnail', 'filmstrip', 'waveform', 'still', 'conformed')),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  mime_type TEXT NOT NULL,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  duration_value INTEGER,
  duration_rate_num INTEGER CHECK (duration_rate_num IS NULL OR duration_rate_num > 0),
  duration_rate_den INTEGER CHECK (duration_rate_den IS NULL OR duration_rate_den > 0),
  frame_rate_num INTEGER CHECK (frame_rate_num IS NULL OR frame_rate_num > 0),
  frame_rate_den INTEGER CHECK (frame_rate_den IS NULL OR frame_rate_den > 0),
  recipe INTEGER NOT NULL CHECK (recipe > 0),
  created_at INTEGER NOT NULL
) STRICT
```

## generated_assets

| Column               | Type    | Null | Default | Key                               |
| -------------------- | ------- | ---- | ------- | --------------------------------- |
| `asset_id`           | TEXT    | no   |         | PK → assets(id) on delete cascade |
| `project_id`         | TEXT    | yes  |         | → projects(id) on delete set null |
| `created_at`         | INTEGER | no   |         |                                   |
| `unreferenced_since` | INTEGER | yes  |         |                                   |

Indexes:

- `generated_assets_project_idx` (project_id) WHERE project_id IS NOT NULL
- `generated_assets_unreferenced_idx` (unreferenced_since)
  WHERE unreferenced_since IS NOT NULL

```sql
CREATE TABLE generated_assets (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  unreferenced_since INTEGER
) STRICT
```

## hub_index_cache

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `id`         | INTEGER | no   |         | PK  |
| `etag`       | TEXT    | yes  |         |     |
| `fetched_at` | INTEGER | no   |         |     |
| `body`       | TEXT    | no   |         |     |

```sql
CREATE TABLE hub_index_cache (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  etag TEXT CHECK (etag IS NULL OR length(etag) BETWEEN 1 AND 512),
  fetched_at INTEGER NOT NULL CHECK (fetched_at >= 0),
  body TEXT NOT NULL CHECK (json_valid(body))
) STRICT
```

## hub_ratings_cache

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `id`         | INTEGER | no   |         | PK  |
| `etag`       | TEXT    | yes  |         |     |
| `fetched_at` | INTEGER | no   |         |     |
| `body`       | TEXT    | no   |         |     |

```sql
CREATE TABLE hub_ratings_cache (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  etag TEXT CHECK (etag IS NULL OR length(etag) BETWEEN 1 AND 512),
  fetched_at INTEGER NOT NULL CHECK (fetched_at >= 0),
  body TEXT NOT NULL CHECK (json_valid(body))
) STRICT
```

## hub_submissions

| Column             | Type    | Null | Default | Key |
| ------------------ | ------- | ---- | ------- | --- |
| `id`               | TEXT    | no   |         | PK  |
| `hub_id`           | TEXT    | no   |         |     |
| `version`          | INTEGER | no   |         |     |
| `template_id`      | TEXT    | no   |         |     |
| `template_version` | INTEGER | no   |         |     |
| `state`            | TEXT    | no   |         |     |
| `created_at`       | INTEGER | no   |         |     |
| `checked_at`       | INTEGER | yes  |         |     |

Indexes:

- `hub_submissions_created_idx` (created_at, id)
- `hub_submissions_template_idx` (template_id, version)

```sql
CREATE TABLE hub_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  hub_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL CHECK (template_version >= 1),
  state TEXT NOT NULL CHECK (state IN ('open', 'merged', 'closed', 'hidden')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  checked_at INTEGER CHECK (checked_at IS NULL OR checked_at >= 0)
) STRICT
```

## import_capture_locks

| Column        | Type    | Null | Default | Key |
| ------------- | ------- | ---- | ------- | --- |
| `capture_key` | TEXT    | no   |         | PK  |
| `pid`         | INTEGER | no   |         |     |

```sql
CREATE TABLE import_capture_locks (capture_key TEXT PRIMARY KEY NOT NULL, pid INTEGER NOT NULL) STRICT
```

## import_draft_items

| Column     | Type    | Null | Default | Key                                      |
| ---------- | ------- | ---- | ------- | ---------------------------------------- |
| `draft_id` | TEXT    | no   |         | PK → import_drafts(id) on delete cascade |
| `id`       | TEXT    | no   |         | PK                                       |
| `ordinal`  | INTEGER | no   |         |                                          |
| `body`     | TEXT    | no   |         |                                          |
| `locator`  | TEXT    | no   |         |                                          |

Indexes:

- `import_draft_items_order` (draft_id,ordinal)

```sql
CREATE TABLE import_draft_items (
 draft_id TEXT NOT NULL REFERENCES import_drafts(id) ON DELETE CASCADE, id TEXT NOT NULL,
 ordinal INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), locator TEXT NOT NULL CHECK(json_valid(locator)),
 PRIMARY KEY(draft_id,id)
) STRICT
```

## import_drafts

| Column         | Type    | Null | Default | Key |
| -------------- | ------- | ---- | ------- | --- |
| `id`           | TEXT    | no   |         | PK  |
| `body`         | TEXT    | no   |         |     |
| `private_data` | TEXT    | no   |         |     |
| `created_at`   | INTEGER | no   |         |     |

```sql
CREATE TABLE import_drafts (
 id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
 private_data TEXT NOT NULL CHECK(json_valid(private_data)), created_at INTEGER NOT NULL
) STRICT
```

## import_provenance

| Column              | Type    | Null | Default | Key                             |
| ------------------- | ------- | ---- | ------- | ------------------------------- |
| `upload_id`         | TEXT    | no   |         | PK                              |
| `asset_id`          | TEXT    | no   |         | → assets(id) on delete cascade  |
| `source_id`         | TEXT    | no   |         | → sources(id) on delete cascade |
| `channel`           | TEXT    | no   |         |                                 |
| `original_filename` | TEXT    | no   |         |                                 |
| `imported_at`       | INTEGER | no   |         |                                 |

Indexes:

- `import_provenance_asset` (asset_id,source_id)

```sql
CREATE TABLE import_provenance (
 upload_id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, channel TEXT NOT NULL,
 original_filename TEXT NOT NULL, imported_at INTEGER NOT NULL
) STRICT
```

## import_session_items

| Column       | Type    | Null | Default | Key                                        |
| ------------ | ------- | ---- | ------- | ------------------------------------------ |
| `session_id` | TEXT    | no   |         | PK → import_sessions(id) on delete cascade |
| `id`         | TEXT    | no   |         | PK                                         |
| `ordinal`    | INTEGER | no   |         |                                            |
| `body`       | TEXT    | no   |         |                                            |

Indexes:

- `import_session_items_order` (session_id,ordinal)

```sql
CREATE TABLE import_session_items (
 session_id TEXT NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE, id TEXT NOT NULL,
 ordinal INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(session_id,id)
) STRICT
```

## import_sessions

| Column       | Type    | Null | Default | Key                                     |
| ------------ | ------- | ---- | ------- | --------------------------------------- |
| `id`         | TEXT    | no   |         | PK                                      |
| `draft_id`   | TEXT    | yes  |         | → import_drafts(id) on delete no action |
| `method`     | TEXT    | no   |         |                                         |
| `status`     | TEXT    | no   |         |                                         |
| `body`       | TEXT    | no   |         |                                         |
| `created_at` | INTEGER | no   |         |                                         |

Indexes:

- `import_sessions_history` (created_at DESC,id DESC)
- `sqlite_autoindex_import_sessions_2` (unique)

```sql
CREATE TABLE import_sessions (
 id TEXT PRIMARY KEY NOT NULL, draft_id TEXT UNIQUE REFERENCES import_drafts(id), method TEXT NOT NULL,
 status TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), created_at INTEGER NOT NULL
) STRICT
```

## import_source_scopes

| Column      | Type    | Null | Default | Key                                |
| ----------- | ------- | ---- | ------- | ---------------------------------- |
| `source_id` | TEXT    | no   |         | PK → sources(id) on delete cascade |
| `recursive` | INTEGER | no   |         |                                    |

```sql
CREATE TABLE import_source_scopes (
  source_id TEXT PRIMARY KEY NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  recursive INTEGER NOT NULL CHECK (recursive IN (0,1))
) STRICT
```

## import_space_reservations

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `owner`      | TEXT    | no   |         | PK  |
| `volume`     | TEXT    | no   |         |     |
| `remaining`  | INTEGER | no   |         |     |
| `pid`        | INTEGER | no   |         |     |
| `updated_at` | INTEGER | no   |         |     |

Indexes:

- `import_space_volume` (volume)

```sql
CREATE TABLE import_space_reservations (
  owner TEXT PRIMARY KEY NOT NULL,
  volume TEXT NOT NULL,
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  pid INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT
```

## import_volume_barriers

| Column   | Type    | Null | Default | Key |
| -------- | ------- | ---- | ------- | --- |
| `volume` | TEXT    | no   |         | PK  |
| `pid`    | INTEGER | no   |         |     |

```sql
CREATE TABLE import_volume_barriers (volume TEXT PRIMARY KEY NOT NULL, pid INTEGER NOT NULL) STRICT
```

## import_volume_readers

| Column   | Type    | Null | Default | Key |
| -------- | ------- | ---- | ------- | --- |
| `owner`  | TEXT    | no   |         | PK  |
| `volume` | TEXT    | no   |         | PK  |
| `pid`    | INTEGER | no   |         |     |

```sql
CREATE TABLE import_volume_readers (
  owner TEXT NOT NULL,
  volume TEXT NOT NULL,
  pid INTEGER NOT NULL,
  PRIMARY KEY (owner, volume)
) STRICT
```

## index_stages

| Column      | Type    | Null | Default | Key |
| ----------- | ------- | ---- | ------- | --- |
| `stage`     | TEXT    | no   |         | PK  |
| `position`  | INTEGER | no   |         |     |
| `milestone` | TEXT    | no   |         |     |

```sql
CREATE TABLE index_stages (
  stage TEXT PRIMARY KEY NOT NULL,
  position INTEGER NOT NULL,
  milestone TEXT NOT NULL CHECK (milestone IN ('searchable', 'complete'))
)
```

## instagram_collections

| Column           | Type    | Null | Default | Key |
| ---------------- | ------- | ---- | ------- | --- |
| `id`             | TEXT    | no   |         | PK  |
| `name`           | TEXT    | no   |         |     |
| `media_count`    | INTEGER | no   | 0       |     |
| `cover_url`      | TEXT    | yes  |         |     |
| `watched`        | INTEGER | no   | 0       |     |
| `auto_breakdown` | INTEGER | no   | 0       |     |
| `last_synced_at` | INTEGER | yes  |         |     |
| `updated_at`     | INTEGER | no   |         |     |

Triggers:

- `style_profiles_on_collection_delete`

```sql
CREATE TABLE instagram_collections (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  media_count INTEGER NOT NULL DEFAULT 0,
  cover_url TEXT,
  watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
  auto_breakdown INTEGER NOT NULL DEFAULT 0 CHECK (auto_breakdown IN (0, 1)),
  last_synced_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT
```

## instagram_saved_reels

| Column          | Type    | Null | Default | Key                                           |
| --------------- | ------- | ---- | ------- | --------------------------------------------- |
| `shortcode`     | TEXT    | no   |         | PK                                            |
| `media_pk`      | TEXT    | no   |         |                                               |
| `collection_id` | TEXT    | no   |         | → instagram_collections(id) on delete cascade |
| `permalink`     | TEXT    | no   |         |                                               |
| `caption`       | TEXT    | yes  |         |                                               |
| `author_handle` | TEXT    | yes  |         |                                               |
| `duration_ms`   | INTEGER | yes  |         |                                               |
| `thumbnail_url` | TEXT    | yes  |         |                                               |
| `saved_at`      | INTEGER | no   |         |                                               |
| `template_id`   | TEXT    | yes  |         | → templates(id) on delete set null            |

Indexes:

- `instagram_saved_reels_template_idx` (template_id) WHERE template_id IS NOT NULL
- `instagram_saved_reels_collection_idx` (collection_id, saved_at, shortcode)

```sql
CREATE TABLE instagram_saved_reels (
  shortcode TEXT PRIMARY KEY NOT NULL,
  media_pk TEXT NOT NULL,
  collection_id TEXT NOT NULL REFERENCES instagram_collections(id) ON DELETE CASCADE,
  permalink TEXT NOT NULL,
  caption TEXT,
  author_handle TEXT,
  duration_ms INTEGER,
  thumbnail_url TEXT,
  saved_at INTEGER NOT NULL,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL
) STRICT
```

## jobs

The durable job queue (PRD G7): leases for the engine, and core's JobRecord. An idempotency key belongs to at most one live job.

| Column             | Type    | Null | Default | Key                               |
| ------------------ | ------- | ---- | ------- | --------------------------------- |
| `id`               | TEXT    | no   |         | PK                                |
| `kind`             | TEXT    | no   |         |                                   |
| `state`            | TEXT    | no   |         |                                   |
| `priority`         | INTEGER | no   | 0       |                                   |
| `resource_class`   | TEXT    | no   |         |                                   |
| `attempts`         | INTEGER | no   | 0       |                                   |
| `max_attempts`     | INTEGER | no   | 3       |                                   |
| `next_run_at`      | INTEGER | yes  |         |                                   |
| `idempotency_key`  | TEXT    | yes  |         |                                   |
| `progress`         | REAL    | yes  |         |                                   |
| `progress_detail`  | TEXT    | yes  |         |                                   |
| `payload`          | TEXT    | no   |         |                                   |
| `result`           | TEXT    | yes  |         |                                   |
| `error`            | TEXT    | yes  |         |                                   |
| `lease_owner`      | TEXT    | yes  |         |                                   |
| `lease_expires_at` | INTEGER | yes  |         |                                   |
| `project_id`       | TEXT    | yes  |         | → projects(id) on delete set null |
| `parent_id`        | TEXT    | yes  |         |                                   |
| `created_at`       | INTEGER | no   |         |                                   |
| `updated_at`       | INTEGER | no   |         |                                   |
| `started_at`       | INTEGER | yes  |         |                                   |
| `finished_at`      | INTEGER | yes  |         |                                   |
| `interruptions`    | INTEGER | no   | 0       |                                   |
| `order_key`        | INTEGER | yes  |         |                                   |

Indexes:

- `jobs_claim_order_idx` (state, resource_class, priority DESC, (order_key IS NULL), order_key,
  coalesce(next_run_at, created_at), id)
- `jobs_parent_idx` (parent_id)
- `jobs_project_idx` (project_id, created_at)
- `jobs_idempotency_live_uq` (unique) (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND state IN ('queued', 'running', 'paused', 'succeeded')
- `jobs_lease_idx` (state, lease_expires_at)

```sql
CREATE TABLE "jobs" (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  resource_class TEXT NOT NULL CHECK (resource_class IN ('cpu', 'gpu', 'npu', 'video', 'io', 'network')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  next_run_at INTEGER,
  idempotency_key TEXT,
  progress REAL CHECK (progress IS NULL OR (progress >= 0 AND progress <= 1)),
  progress_detail TEXT CHECK (progress_detail IS NULL OR json_valid(progress_detail)),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  error TEXT CHECK (error IS NULL OR json_valid(error)),
  lease_owner TEXT,
  lease_expires_at INTEGER,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  interruptions INTEGER NOT NULL DEFAULT 0 CHECK (interruptions >= 0)
, order_key INTEGER) STRICT
```

## local_import_receipts

| Column        | Type    | Null | Default | Key                                      |
| ------------- | ------- | ---- | ------- | ---------------------------------------- |
| `fingerprint` | TEXT    | no   |         | PK                                       |
| `asset_ids`   | TEXT    | no   |         |                                          |
| `archive_id`  | TEXT    | yes  |         | → capture_archives(id) on delete cascade |
| `updated_at`  | INTEGER | no   |         |                                          |

```sql
CREATE TABLE local_import_receipts (
  fingerprint TEXT PRIMARY KEY NOT NULL,
  asset_ids TEXT NOT NULL CHECK (json_valid(asset_ids)),
  archive_id TEXT REFERENCES capture_archives(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL
) STRICT
```

## memory_fts

| Column       | Type | Null | Default | Key |
| ------------ | ---- | ---- | ------- | --- |
| `memory_id`  |      | yes  |         |     |
| `text`       |      | yes  |         |     |
| `memory_fts` |      | yes  |         |     |
| `rank`       |      | yes  |         |     |

```sql
CREATE VIRTUAL TABLE memory_fts USING fts5(
  memory_id UNINDEXED, text,
  tokenize = "unicode61 remove_diacritics 2 categories 'L* N* Co M*'"
)
```

## memory_items

| Column            | Type    | Null | Default | Key                                    |
| ----------------- | ------- | ---- | ------- | -------------------------------------- |
| `id`              | TEXT    | no   |         | PK                                     |
| `scope`           | TEXT    | no   |         |                                        |
| `project_id`      | TEXT    | yes  |         | → projects(id) on delete cascade       |
| `template_id`     | TEXT    | yes  |         | → templates(id) on delete cascade      |
| `text`            | TEXT    | no   |         |                                        |
| `source`          | TEXT    | no   |         |                                        |
| `data_kind`       | TEXT    | yes  |         |                                        |
| `data`            | TEXT    | yes  |         |                                        |
| `conversation_id` | TEXT    | yes  |         | → conversations(id) on delete set null |
| `revision`        | INTEGER | no   |         |                                        |
| `created_at`      | INTEGER | no   |         |                                        |
| `updated_at`      | INTEGER | no   |         |                                        |

Triggers:

- `memory_fts_on_delete`
- `memory_fts_on_insert`
- `memory_fts_on_update`

Indexes:

- `memory_items_data_kind_idx` (data_kind) WHERE data_kind IS NOT NULL
- `memory_items_template_idx` (template_id) WHERE template_id IS NOT NULL
- `memory_items_project_idx` (project_id) WHERE project_id IS NOT NULL
- `memory_items_updated_idx` (updated_at, id)

```sql
CREATE TABLE memory_items (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('user', 'project', 'template')),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES templates(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  source TEXT NOT NULL CHECK (source IN ('user', 'agent', 'learned')),
  data_kind TEXT CHECK (data_kind IN ('casting-weights', 'what-worked')),
  data TEXT CHECK (data IS NULL OR json_valid(data)),
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((scope = 'project') = (project_id IS NOT NULL)),
  CHECK ((scope = 'template') = (template_id IS NOT NULL)),
  CHECK ((data IS NULL) = (data_kind IS NULL))
) STRICT
```

## messages

One chat message; `content` holds parts, cards and artifact references as JSON.

| Column            | Type    | Null | Default | Key                                   |
| ----------------- | ------- | ---- | ------- | ------------------------------------- |
| `id`              | TEXT    | no   |         | PK                                    |
| `conversation_id` | TEXT    | no   |         | → conversations(id) on delete cascade |
| `role`            | TEXT    | no   |         |                                       |
| `content`         | TEXT    | no   |         |                                       |
| `run_id`          | TEXT    | yes  |         |                                       |
| `created_at`      | INTEGER | no   |         |                                       |

Indexes:

- `messages_conversation_idx` (conversation_id, id)

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL CHECK (json_valid(content)),
  run_id TEXT,
  created_at INTEGER NOT NULL
) STRICT
```

## model_profile_state

The model-profile document (PRD 8.4), opaque JSON owned by @taalcut/models. One row.

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `id`         | INTEGER | no   |         | PK  |
| `state`      | TEXT    | no   |         |     |
| `updated_at` | INTEGER | no   |         |     |

```sql
CREATE TABLE model_profile_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  state TEXT NOT NULL CHECK (json_valid(state)),
  updated_at INTEGER NOT NULL
) STRICT
```

## photos_imports

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `asset_key`  | TEXT    | no   |         | PK  |
| `manifest`   | TEXT    | no   |         |     |
| `updated_at` | INTEGER | no   |         |     |

```sql
CREATE TABLE photos_imports (
  asset_key TEXT PRIMARY KEY NOT NULL,
  manifest TEXT NOT NULL CHECK (json_valid(manifest)),
  updated_at INTEGER NOT NULL
) STRICT
```

## product_campaigns

| Column       | Type    | Null | Default | Key                                     |
| ------------ | ------- | ---- | ------- | --------------------------------------- |
| `id`         | TEXT    | no   |         | PK                                      |
| `product_id` | TEXT    | no   |         | → products(id) on delete cascade        |
| `idea_id`    | TEXT    | no   |         | → product_ideas(id) on delete no action |
| `project_id` | TEXT    | no   |         |                                         |
| `revision`   | INTEGER | no   |         |                                         |
| `created_at` | INTEGER | no   |         |                                         |
| `body_json`  | TEXT    | no   |         |                                         |

Indexes:

- `product_campaigns_page` (product_id, id DESC)
- `product_campaigns_history` (product_id, created_at DESC)
- `product_campaigns_project` (project_id)
- `sqlite_autoindex_product_campaigns_2` (unique)

```sql
CREATE TABLE product_campaigns (
  id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  idea_id TEXT NOT NULL REFERENCES product_ideas(id), project_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0), created_at INTEGER NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json)), UNIQUE(product_id, idea_id)
) STRICT
```

## product_ideas

| Column        | Type    | Null | Default | Key                              |
| ------------- | ------- | ---- | ------- | -------------------------------- |
| `id`          | TEXT    | no   |         | PK                               |
| `product_id`  | TEXT    | no   |         | → products(id) on delete cascade |
| `status`      | TEXT    | no   |         |                                  |
| `feature_key` | TEXT    | no   |         |                                  |
| `created_at`  | INTEGER | no   |         |                                  |
| `body_json`   | TEXT    | no   |         |                                  |

Indexes:

- `product_ideas_page` (product_id, id DESC)
- `product_ideas_feature` (product_id, feature_key, created_at DESC)
- `product_ideas_history` (product_id, created_at DESC)

```sql
CREATE TABLE product_ideas (
  id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL, feature_key TEXT NOT NULL, created_at INTEGER NOT NULL, body_json TEXT NOT NULL CHECK(json_valid(body_json))
) STRICT
```

## product_knowledge

| Column       | Type | Null | Default | Key                              |
| ------------ | ---- | ---- | ------- | -------------------------------- |
| `id`         | TEXT | no   |         | PK                               |
| `product_id` | TEXT | no   |         | → products(id) on delete cascade |
| `source_id`  | TEXT | no   |         |                                  |
| `locator`    | TEXT | no   |         |                                  |
| `digest`     | TEXT | no   |         |                                  |
| `body_json`  | TEXT | no   |         |                                  |

Triggers:

- `product_knowledge_fts_delete`
- `product_knowledge_fts_insert`
- `product_knowledge_fts_update`

Indexes:

- `product_knowledge_source_page` (product_id, source_id, id)
- `product_knowledge_coverage` (product_id, locator, id)
- `product_knowledge_page` (product_id, id)
- `product_knowledge_source` (product_id, source_id)
- `sqlite_autoindex_product_knowledge_2` (unique)

```sql
CREATE TABLE product_knowledge (
  id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, locator TEXT NOT NULL, digest TEXT NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json)), UNIQUE(product_id, source_id, locator)
) STRICT
```

## product_knowledge_fts

| Column                  | Type | Null | Default | Key |
| ----------------------- | ---- | ---- | ------- | --- |
| `product_id`            |      | yes  |         |     |
| `title`                 |      | yes  |         |     |
| `text`                  |      | yes  |         |     |
| `product_knowledge_fts` |      | yes  |         |     |
| `rank`                  |      | yes  |         |     |

```sql
CREATE VIRTUAL TABLE product_knowledge_fts USING fts5(product_id, title, text, tokenize='unicode61')
```

## product_notifications

| Column       | Type    | Null | Default | Key                              |
| ------------ | ------- | ---- | ------- | -------------------------------- |
| `id`         | TEXT    | no   |         | PK                               |
| `product_id` | TEXT    | no   |         | → products(id) on delete cascade |
| `created_at` | INTEGER | no   |         |                                  |
| `read_at`    | INTEGER | yes  |         |                                  |
| `body_json`  | TEXT    | no   |         |                                  |

Indexes:

- `product_notifications_inbox` (product_id, created_at DESC)

```sql
CREATE TABLE product_notifications (
  id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, read_at INTEGER, body_json TEXT NOT NULL CHECK(json_valid(body_json))
) STRICT
```

## product_occurrences

| Column          | Type    | Null | Default | Key                              |
| --------------- | ------- | ---- | ------- | -------------------------------- |
| `id`            | TEXT    | no   |         | PK                               |
| `product_id`    | TEXT    | no   |         | → products(id) on delete cascade |
| `scheduled_for` | INTEGER | no   |         |                                  |
| `state`         | TEXT    | no   |         |                                  |
| `lease_until`   | INTEGER | no   |         |                                  |
| `body_json`     | TEXT    | no   |         |                                  |

Indexes:

- `product_occurrences_expired` (state, lease_until)
- `sqlite_autoindex_product_occurrences_2` (unique)

```sql
CREATE TABLE product_occurrences (
  id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  scheduled_for INTEGER NOT NULL, state TEXT NOT NULL, lease_until INTEGER NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json)), UNIQUE(product_id, scheduled_for)
) STRICT
```

## product_publications

| Column        | Type    | Null | Default | Key                              |
| ------------- | ------- | ---- | ------- | -------------------------------- |
| `id`          | TEXT    | no   |         | PK                               |
| `batch_id`    | TEXT    | no   |         |                                  |
| `product_id`  | TEXT    | no   |         | → products(id) on delete cascade |
| `campaign_id` | TEXT    | no   |         |                                  |
| `status`      | TEXT    | no   |         |                                  |
| `revision`    | INTEGER | no   |         |                                  |
| `updated_at`  | INTEGER | no   |         |                                  |
| `body_json`   | TEXT    | no   |         |                                  |

Indexes:

- `product_publications_status` (status, updated_at)
- `product_publications_campaign` (campaign_id)

```sql
CREATE TABLE product_publications (
  id TEXT PRIMARY KEY NOT NULL, batch_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, campaign_id TEXT NOT NULL,
  status TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), updated_at INTEGER NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json))
) STRICT
```

## product_publish_reconcile_cursor

| Column      | Type    | Null | Default | Key |
| ----------- | ------- | ---- | ------- | --- |
| `singleton` | INTEGER | no   |         | PK  |
| `after_id`  | TEXT    | yes  |         |     |

```sql
CREATE TABLE product_publish_reconcile_cursor (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1), after_id TEXT
)
```

## product_schedules

| Column        | Type    | Null | Default | Key                                 |
| ------------- | ------- | ---- | ------- | ----------------------------------- |
| `product_id`  | TEXT    | no   |         | PK → products(id) on delete cascade |
| `revision`    | INTEGER | no   |         |                                     |
| `enabled`     | INTEGER | no   |         |                                     |
| `next_run_at` | INTEGER | yes  |         |                                     |
| `body_json`   | TEXT    | no   |         |                                     |

Indexes:

- `product_schedules_due` (enabled, next_run_at)

```sql
CREATE TABLE product_schedules (
  product_id TEXT PRIMARY KEY NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  next_run_at INTEGER, body_json TEXT NOT NULL CHECK(json_valid(body_json))
) STRICT
```

## products

| Column        | Type    | Null | Default | Key |
| ------------- | ------- | ---- | ------- | --- |
| `id`          | TEXT    | no   |         | PK  |
| `revision`    | INTEGER | no   |         |     |
| `archived_at` | INTEGER | yes  |         |     |
| `updated_at`  | INTEGER | no   |         |     |
| `body_json`   | TEXT    | no   |         |     |

Indexes:

- `products_active` (archived_at, id)

```sql
CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
  archived_at INTEGER, updated_at INTEGER NOT NULL, body_json TEXT NOT NULL CHECK(json_valid(body_json))
) STRICT
```

## project_styles

| Column       | Type    | Null | Default | Key                                 |
| ------------ | ------- | ---- | ------- | ----------------------------------- |
| `project_id` | TEXT    | no   |         | PK → projects(id) on delete cascade |
| `source_key` | TEXT    | no   |         |                                     |
| `updated_at` | INTEGER | no   |         |                                     |

Indexes:

- `project_styles_source_idx` (source_key)

```sql
CREATE TABLE project_styles (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  updated_at INTEGER NOT NULL
) STRICT
```

## projects

A video project (PRD 6.3).

| Column                | Type    | Null | Default | Key |
| --------------------- | ------- | ---- | ------- | --- |
| `id`                  | TEXT    | no   |         | PK  |
| `name`                | TEXT    | no   |         |     |
| `created_at`          | INTEGER | no   |         |     |
| `updated_at`          | INTEGER | no   |         |     |
| `archived_at`         | INTEGER | yes  |         |     |
| `last_opened_at`      | INTEGER | yes  |         |     |
| `budget_cap_micros`   | INTEGER | yes  |         |     |
| `budget_cap_currency` | TEXT    | yes  |         |     |

Indexes:

- `projects_archived_idx` (archived_at, updated_at)

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, archived_at INTEGER, last_opened_at INTEGER, budget_cap_micros INTEGER CHECK (budget_cap_micros IS NULL OR budget_cap_micros >= 0), budget_cap_currency TEXT CHECK (budget_cap_currency IS NULL OR length(budget_cap_currency) = 3)) STRICT
```

## renders

One row per RenderRecord; the file path and full QA report never reach a window.

| Column              | Type    | Null | Default | Key                              |
| ------------------- | ------- | ---- | ------- | -------------------------------- |
| `id`                | TEXT    | no   |         | PK                               |
| `project_id`        | TEXT    | no   |         | → projects(id) on delete cascade |
| `timeline_id`       | TEXT    | no   |         |                                  |
| `timeline_revision` | INTEGER | no   |         |                                  |
| `preset_id`         | TEXT    | no   |         |                                  |
| `status`            | TEXT    | no   |         |                                  |
| `job_id`            | TEXT    | yes  |         |                                  |
| `name`              | TEXT    | no   |         |                                  |
| `width`             | INTEGER | no   |         |                                  |
| `height`            | INTEGER | no   |         |                                  |
| `rate_num`          | INTEGER | no   |         |                                  |
| `rate_den`          | INTEGER | no   |         |                                  |
| `duration_frames`   | INTEGER | no   |         |                                  |
| `bytes`             | INTEGER | yes  |         |                                  |
| `music`             | TEXT    | no   |         |                                  |
| `captions`          | TEXT    | no   |         |                                  |
| `qa`                | TEXT    | yes  |         |                                  |
| `qa_report`         | TEXT    | yes  |         |                                  |
| `supersedes`        | TEXT    | yes  |         |                                  |
| `notify`            | INTEGER | no   |         |                                  |
| `error`             | TEXT    | yes  |         |                                  |
| `request`           | TEXT    | no   |         |                                  |
| `request_key`       | TEXT    | no   |         |                                  |
| `file_path`         | TEXT    | yes  |         |                                  |
| `composition_hash`  | TEXT    | yes  |         |                                  |
| `created_at`        | INTEGER | no   |         |                                  |
| `finished_at`       | INTEGER | yes  |         |                                  |
| `deleted_at`        | INTEGER | yes  |         |                                  |
| `credentials`       | TEXT    | yes  |         |                                  |
| `batch_id`          | TEXT    | yes  |         |                                  |

Indexes:

- `renders_batch_idx` (batch_id) WHERE batch_id IS NOT NULL
- `renders_timeline_idx` (timeline_id, timeline_revision)
- `renders_request_key_idx` (request_key, status)
- `renders_project_idx` (project_id, created_at)

```sql
CREATE TABLE renders (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline_id TEXT NOT NULL,
  timeline_revision INTEGER NOT NULL CHECK (timeline_revision >= 1),
  preset_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'checking', 'fixing', 'ready', 'needsAttention', 'failed', 'cancelled')),
  job_id TEXT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  rate_num INTEGER NOT NULL CHECK (rate_num > 0),
  rate_den INTEGER NOT NULL CHECK (rate_den > 0),
  duration_frames INTEGER NOT NULL CHECK (duration_frames >= 0),
  bytes INTEGER CHECK (bytes IS NULL OR bytes >= 0),
  music TEXT NOT NULL,
  captions TEXT NOT NULL CHECK (json_valid(captions)),
  qa TEXT CHECK (qa IS NULL OR json_valid(qa)),
  qa_report TEXT CHECK (qa_report IS NULL OR json_valid(qa_report)),
  supersedes TEXT,
  notify INTEGER NOT NULL CHECK (notify IN (0, 1)),
  error TEXT CHECK (error IS NULL OR json_valid(error)),
  request TEXT NOT NULL CHECK (json_valid(request)),
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 1 AND 256),
  file_path TEXT,
  composition_hash TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  deleted_at INTEGER
, credentials TEXT CHECK (credentials IS NULL OR json_valid(credentials)), batch_id TEXT) STRICT
```

## settings

Settings as JSON values by key. Never secrets.

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `key`        | TEXT    | no   |         | PK  |
| `value`      | TEXT    | no   |         |     |
| `updated_at` | INTEGER | no   |         |     |

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at INTEGER NOT NULL
) STRICT
```

## shorts_analysis_cache

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `key`        | TEXT    | no   |         | PK  |
| `document`   | TEXT    | no   |         |     |
| `updated_at` | INTEGER | no   |         |     |

```sql
CREATE TABLE shorts_analysis_cache (
  key TEXT PRIMARY KEY NOT NULL,
  document TEXT NOT NULL CHECK (json_valid(document)),
  updated_at INTEGER NOT NULL
) STRICT
```

## shorts_runs

| Column       | Type    | Null | Default | Key                              |
| ------------ | ------- | ---- | ------- | -------------------------------- |
| `id`         | TEXT    | no   |         | PK                               |
| `project_id` | TEXT    | no   |         | → projects(id) on delete cascade |
| `document`   | TEXT    | no   |         |                                  |
| `updated_at` | INTEGER | no   |         |                                  |

Indexes:

- `shorts_runs_project_idx` (project_id, updated_at)

```sql
CREATE TABLE shorts_runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK (json_valid(document)),
  updated_at INTEGER NOT NULL
) STRICT
```

## shot_actions

| Column    | Type | Null | Default | Key                              |
| --------- | ---- | ---- | ------- | -------------------------------- |
| `action`  | TEXT | no   |         | PK                               |
| `shot_id` | TEXT | no   |         | PK → shots(id) on delete cascade |

Indexes:

- `shot_actions_shot_idx` (shot_id)

```sql
CREATE TABLE shot_actions (
  action TEXT NOT NULL,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  PRIMARY KEY (action, shot_id)
) STRICT, WITHOUT ROWID
```

## shot_fts

FTS5 over each shot: description, labels, on-screen text, transcript and file name. Triggers on `shots` and `assets` keep it in step; the tokenizer keeps Devanagari marks inside words.

| Column           | Type | Null | Default | Key |
| ---------------- | ---- | ---- | ------- | --- |
| `description`    |      | yes  |         |     |
| `labels`         |      | yes  |         |     |
| `on_screen_text` |      | yes  |         |     |
| `transcript`     |      | yes  |         |     |
| `file_name`      |      | yes  |         |     |
| `actions`        |      | yes  |         |     |
| `shot_fts`       |      | yes  |         |     |
| `rank`           |      | yes  |         |     |

```sql
CREATE VIRTUAL TABLE shot_fts USING fts5(description, labels, on_screen_text, transcript, file_name, actions, tokenize = "unicode61 remove_diacritics 2 categories 'L* N* Co M*'")
```

## shot_search_rows

A stable integer key per shot for `shot_fts`; written by triggers only.

| Column    | Type    | Null | Default | Key |
| --------- | ------- | ---- | ------- | --- |
| `rowid`   | INTEGER | no   |         | PK  |
| `shot_id` | TEXT    | no   |         |     |

Indexes:

- `shot_search_rows_shot_uq` (unique) (shot_id)

```sql
CREATE TABLE shot_search_rows (
  rowid INTEGER PRIMARY KEY NOT NULL,
  shot_id TEXT NOT NULL
) STRICT
```

## shots

**Provisional** (ADR 0001): shot timing within an asset, as integer RationalTime.

| Column              | Type    | Null | Default | Key                            |
| ------------------- | ------- | ---- | ------- | ------------------------------ |
| `id`                | TEXT    | no   |         | PK                             |
| `asset_id`          | TEXT    | no   |         | → assets(id) on delete cascade |
| `index_in_asset`    | INTEGER | no   |         |                                |
| `start_value`       | INTEGER | no   |         |                                |
| `start_rate_num`    | INTEGER | no   |         |                                |
| `start_rate_den`    | INTEGER | no   |         |                                |
| `duration_value`    | INTEGER | no   |         |                                |
| `duration_rate_num` | INTEGER | no   |         |                                |
| `duration_rate_den` | INTEGER | no   |         |                                |
| `analysis`          | TEXT    | yes  |         |                                |
| `description`       | TEXT    | yes  |         |                                |
| `objects`           | TEXT    | yes  |         |                                |
| `place`             | TEXT    | yes  |         |                                |
| `shot_type`         | TEXT    | yes  |         |                                |
| `motion`            | TEXT    | yes  |         |                                |
| `energy`            | REAL    | yes  |         |                                |
| `quality`           | REAL    | yes  |         |                                |
| `on_screen_text`    | TEXT    | yes  |         |                                |
| `best_frame`        | INTEGER | yes  |         |                                |
| `d_hash`            | TEXT    | yes  |         |                                |
| `transcript_text`   | TEXT    | yes  |         |                                |
| `duplicate_group`   | TEXT    | yes  |         |                                |
| `best_take`         | INTEGER | no   | 1       |                                |
| `generation`        | INTEGER | no   | 0       |                                |
| `created_at`        | INTEGER | no   | 0       |                                |

Triggers:

- `shot_actions_on_update`
- `shot_fts_on_delete`
- `shot_fts_on_insert`
- `shot_fts_on_update`
- `shots_duplicate_group_on_delete`

Indexes:

- `shots_duplicate_group_idx` (duplicate_group) WHERE duplicate_group IS NOT NULL
- `shots_asset_index_uq` (unique) (asset_id, index_in_asset)

```sql
CREATE TABLE "shots" (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  index_in_asset INTEGER NOT NULL CHECK (index_in_asset >= 0),
  start_value INTEGER NOT NULL,
  start_rate_num INTEGER NOT NULL CHECK (start_rate_num > 0),
  start_rate_den INTEGER NOT NULL CHECK (start_rate_den > 0),
  duration_value INTEGER NOT NULL CHECK (duration_value >= 0),
  duration_rate_num INTEGER NOT NULL CHECK (duration_rate_num > 0),
  duration_rate_den INTEGER NOT NULL CHECK (duration_rate_den > 0)
, analysis TEXT CHECK (analysis IS NULL OR json_valid(analysis)), description TEXT, objects TEXT, place TEXT, shot_type TEXT, motion TEXT, energy REAL CHECK (energy IS NULL OR (energy >= 0 AND energy <= 1)), quality REAL CHECK (quality IS NULL OR (quality >= 0 AND quality <= 1)), on_screen_text TEXT, best_frame INTEGER CHECK (best_frame IS NULL OR best_frame >= 0), d_hash TEXT, transcript_text TEXT, duplicate_group TEXT, best_take INTEGER NOT NULL DEFAULT 1 CHECK (best_take IN (0, 1)), generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0), created_at INTEGER NOT NULL DEFAULT 0) STRICT
```

## sources

**Provisional** (ADR 0001, awaiting D4 approval): a watched-folder root or a phone import session, identified by root path plus APFS Volume UUID.

| Column                | Type    | Null | Default | Key |
| --------------------- | ------- | ---- | ------- | --- |
| `id`                  | TEXT    | no   |         | PK  |
| `kind`                | TEXT    | no   |         |     |
| `display_name`        | TEXT    | no   |         |     |
| `root_path`           | TEXT    | no   |         |     |
| `volume_uuid`         | TEXT    | yes  |         |     |
| `volume_name`         | TEXT    | yes  |         |     |
| `status`              | TEXT    | no   |         |     |
| `created_at`          | INTEGER | no   |         |     |
| `updated_at`          | INTEGER | no   |         |     |
| `watch`               | INTEGER | no   | 1       |     |
| `scan_state`          | TEXT    | no   | 'idle'  |     |
| `scan_cursor`         | TEXT    | yes  |         |     |
| `last_scan_at`        | INTEGER | yes  |         |     |
| `scan_error`          | TEXT    | yes  |         |     |
| `transfer_session_id` | TEXT    | yes  |         |     |
| `device_label`        | TEXT    | yes  |         |     |

Indexes:

- `sources_transfer_session_uq` (unique) (transfer_session_id) WHERE transfer_session_id IS NOT NULL

```sql
CREATE TABLE "sources" (
 id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('wifi_import','usb_import','watched_folder','stock_import','generated','bundled','local_import','camera_import','photos_import')),
 display_name TEXT NOT NULL, root_path TEXT NOT NULL, volume_uuid TEXT, volume_name TEXT,
 status TEXT NOT NULL CHECK(status IN ('online','offline','missing')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 watch INTEGER NOT NULL DEFAULT 1 CHECK(watch IN (0,1)),
 scan_state TEXT NOT NULL DEFAULT 'idle' CHECK(scan_state IN ('idle','scanning','error')),
 scan_cursor TEXT, last_scan_at INTEGER, scan_error TEXT CHECK(scan_error IS NULL OR json_valid(scan_error)),
 transfer_session_id TEXT, device_label TEXT
) STRICT
```

## stock_search_cache

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `key`        | TEXT    | no   |         | PK  |
| `provider`   | TEXT    | no   |         |     |
| `body`       | TEXT    | no   |         |     |
| `fetched_at` | INTEGER | no   |         |     |

```sql
CREATE TABLE stock_search_cache (
  key TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
) STRICT
```

## style_assets

| Column        | Type    | Null | Default | Key |
| ------------- | ------- | ---- | ------- | --- |
| `sha256`      | TEXT    | no   |         | PK  |
| `media_type`  | TEXT    | no   |         |     |
| `bytes`       | INTEGER | no   |         |     |
| `created_at`  | INTEGER | no   |         |     |
| `released_at` | INTEGER | yes  |         |     |

```sql
CREATE TABLE style_assets (
  sha256 TEXT PRIMARY KEY NOT NULL CHECK (length(sha256) = 64),
  media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  created_at INTEGER NOT NULL,
  released_at INTEGER
) STRICT
```

## style_profiles

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `source_key` | TEXT    | no   |         | PK  |
| `digest`     | TEXT    | no   |         |     |
| `profile`    | TEXT    | yes  |         |     |
| `summary`    | TEXT    | no   |         |     |
| `built_at`   | INTEGER | no   |         |     |

```sql
CREATE TABLE style_profiles (
  source_key TEXT PRIMARY KEY NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  profile TEXT CHECK (profile IS NULL OR json_valid(profile)),
  summary TEXT NOT NULL CHECK (json_valid(summary)),
  built_at INTEGER NOT NULL
) STRICT
```

## styles

| Column                  | Type    | Null | Default | Key |
| ----------------------- | ------- | ---- | ------- | --- |
| `id`                    | TEXT    | no   |         | PK  |
| `name`                  | TEXT    | no   |         |     |
| `kind`                  | TEXT    | no   |         |     |
| `revision`              | INTEGER | no   |         |     |
| `schema_version`        | INTEGER | no   |         |     |
| `document`              | TEXT    | no   |         |     |
| `made_from_template_id` | TEXT    | yes  |         |     |
| `made_from_version`     | INTEGER | yes  |         |     |
| `logo_asset`            | TEXT    | yes  |         |     |
| `created_at`            | INTEGER | no   |         |     |
| `updated_at`            | INTEGER | no   |         |     |

Indexes:

- `styles_logo_idx` (logo_asset) WHERE logo_asset IS NOT NULL
- `styles_made_from_idx` (made_from_template_id, made_from_version)
  WHERE made_from_template_id IS NOT NULL
- `styles_updated_idx` (updated_at, id)

```sql
CREATE TABLE styles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('brandKit', 'look')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  document TEXT NOT NULL CHECK (json_valid(document)),
  made_from_template_id TEXT,
  made_from_version INTEGER CHECK (made_from_version IS NULL OR made_from_version >= 1),
  logo_asset TEXT CHECK (logo_asset IS NULL OR length(logo_asset) = 64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT
```

## telemetry_outbox

Queued telemetry envelopes (at most 5,000), checked on append and on take.

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `id`         | INTEGER | no   |         | PK  |
| `envelope`   | TEXT    | no   |         |     |
| `created_at` | INTEGER | no   |         |     |

```sql
CREATE TABLE telemetry_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  envelope TEXT NOT NULL CHECK (json_valid(envelope)),
  created_at INTEGER NOT NULL
) STRICT
```

## template_assets

Content-addressed template assets (contact sheets); the bytes are files named by sha256.

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `sha256`     | TEXT    | no   |         | PK  |
| `media_type` | TEXT    | no   |         |     |
| `bytes`      | INTEGER | no   |         |     |
| `created_at` | INTEGER | no   |         |     |

```sql
CREATE TABLE template_assets (
  sha256 TEXT PRIMARY KEY NOT NULL CHECK (length(sha256) = 64),
  media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/webp')),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  created_at INTEGER NOT NULL
) STRICT
```

## template_folders

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `id`         | TEXT    | no   |         | PK  |
| `name`       | TEXT    | no   |         |     |
| `name_key`   | TEXT    | no   |         |     |
| `created_at` | INTEGER | no   |         |     |

Triggers:

- `style_profiles_on_folder_delete`

Indexes:

- `template_folders_name_uq` (unique) (name_key)

```sql
CREATE TABLE template_folders (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  name_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT
```

## template_fts

FTS5 over each lineage's head: name, slot intents, overlay text.

| Column         | Type | Null | Default | Key |
| -------------- | ---- | ---- | ------- | --- |
| `template_id`  |      | yes  |         |     |
| `name`         |      | yes  |         |     |
| `intents`      |      | yes  |         |     |
| `overlays`     |      | yes  |         |     |
| `tags`         |      | yes  |         |     |
| `template_fts` |      | yes  |         |     |
| `rank`         |      | yes  |         |     |

```sql
CREATE VIRTUAL TABLE "template_fts" USING fts5(
  template_id UNINDEXED, name, intents, overlays, tags,
  tokenize = "unicode61 remove_diacritics 2 categories 'L* N* Co M*'"
)
```

## template_media

| Column        | Type    | Null | Default | Key                                  |
| ------------- | ------- | ---- | ------- | ------------------------------------ |
| `template_id` | TEXT    | no   |         | PK → templates(id) on delete cascade |
| `file`        | TEXT    | no   |         |                                      |
| `bytes`       | INTEGER | no   |         |                                      |
| `duration_ms` | INTEGER | no   |         |                                      |
| `sha256`      | TEXT    | no   |         |                                      |
| `has_audio`   | INTEGER | no   |         |                                      |
| `source`      | TEXT    | no   |         |                                      |
| `kept_at`     | INTEGER | no   |         |                                      |

```sql
CREATE TABLE template_media (
  template_id TEXT PRIMARY KEY NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  file TEXT NOT NULL CHECK (
    length(file) BETWEEN 1 AND 64 AND file GLOB '[a-z0-9]*' AND file NOT GLOB '*[^a-z0-9._-]*'
  ),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  has_audio INTEGER NOT NULL CHECK (has_audio IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('anonymous', 'session', 'file')),
  kept_at INTEGER NOT NULL
) STRICT
```

## template_versions

Immutable template versions: the Template as JSON, its parent and change key, and summary columns read from it.

| Column              | Type    | Null | Default | Key                                  |
| ------------------- | ------- | ---- | ------- | ------------------------------------ |
| `template_id`       | TEXT    | no   |         | PK → templates(id) on delete cascade |
| `version`           | INTEGER | no   |         | PK                                   |
| `parent_version`    | INTEGER | yes  |         |                                      |
| `schema_version`    | INTEGER | no   |         |                                      |
| `document`          | TEXT    | no   |         |                                      |
| `change_key`        | TEXT    | yes  |         |                                      |
| `command`           | TEXT    | yes  |         |                                      |
| `source`            | TEXT    | yes  |         |                                      |
| `origin`            | TEXT    | no   |         |                                      |
| `platform`          | TEXT    | yes  |         |                                      |
| `fingerprint`       | TEXT    | yes  |         |                                      |
| `duration_value`    | INTEGER | no   |         |                                      |
| `duration_rate_num` | INTEGER | no   |         |                                      |
| `duration_rate_den` | INTEGER | no   |         |                                      |
| `slot_count`        | INTEGER | no   |         |                                      |
| `bpm`               | REAL    | yes  |         |                                      |
| `contact_sheet`     | TEXT    | yes  |         |                                      |
| `created_at`        | INTEGER | no   |         |                                      |
| `format_id`         | TEXT    | yes  |         |                                      |
| `language`          | TEXT    | yes  |         |                                      |
| `style_id`          | TEXT    | yes  |         |                                      |
| `approved_slots`    | INTEGER | no   | 0       |                                      |
| `slot_strip`        | TEXT    | no   | '[]'    |                                      |

Indexes:

- `template_versions_style_idx` (style_id) WHERE style_id IS NOT NULL
- `template_versions_language_idx` (language) WHERE language IS NOT NULL
- `template_versions_format_idx` (format_id) WHERE format_id IS NOT NULL
- `template_versions_sheet_idx` (contact_sheet) WHERE contact_sheet IS NOT NULL
- `template_versions_fingerprint_idx` (fingerprint) WHERE fingerprint IS NOT NULL
- `template_versions_child_idx` (template_id, parent_version, change_key)

```sql
CREATE TABLE template_versions (
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  parent_version INTEGER CHECK (parent_version IS NULL OR parent_version >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  document TEXT NOT NULL CHECK (json_valid(document)),
  change_key TEXT CHECK (change_key IS NULL OR length(change_key) BETWEEN 1 AND 128),
  command TEXT,
  source TEXT CHECK (source IS NULL OR source IN ('ui', 'shortcut', 'agent', 'mcp')),
  origin TEXT NOT NULL CHECK (origin IN ('reference', 'format', 'manual')),
  platform TEXT,
  fingerprint TEXT,
  duration_value INTEGER NOT NULL CHECK (duration_value >= 0),
  duration_rate_num INTEGER NOT NULL CHECK (duration_rate_num > 0),
  duration_rate_den INTEGER NOT NULL CHECK (duration_rate_den > 0),
  slot_count INTEGER NOT NULL CHECK (slot_count >= 1),
  bpm REAL,
  contact_sheet TEXT,
  created_at INTEGER NOT NULL, format_id TEXT, language TEXT, style_id TEXT, approved_slots INTEGER NOT NULL DEFAULT 0 CHECK (approved_slots >= 0), slot_strip TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(slot_strip) AND json_type(slot_strip) = 'array'),
  PRIMARY KEY (template_id, version)
) STRICT
```

## templates

A template lineage (P2-T8): name, project, listing, archive and its head version.

| Column         | Type    | Null | Default | Key                                       |
| -------------- | ------- | ---- | ------- | ----------------------------------------- |
| `id`           | TEXT    | no   |         | PK                                        |
| `name`         | TEXT    | no   |         |                                           |
| `project_id`   | TEXT    | yes  |         | → projects(id) on delete set null         |
| `listed`       | INTEGER | no   |         |                                           |
| `head_version` | INTEGER | no   |         |                                           |
| `archived_at`  | INTEGER | yes  |         |                                           |
| `created_at`   | INTEGER | no   |         |                                           |
| `updated_at`   | INTEGER | no   |         |                                           |
| `tags`         | TEXT    | no   | '[]'    |                                           |
| `folder_id`    | TEXT    | yes  |         | → template_folders(id) on delete set null |
| `favourite`    | INTEGER | no   | 0       |                                           |
| `trend_date`   | TEXT    | yes  |         |                                           |
| `trend_source` | TEXT    | yes  |         |                                           |
| `provenance`   | TEXT    | yes  |         |                                           |
| `name_key`     | TEXT    | no   | ''      |                                           |

Indexes:

- `templates_name_key_desc_idx` (name_key, id)
- `templates_name_key_asc_idx` (name_key, id DESC)
- `templates_trend_idx` (trend_date, id) WHERE trend_date IS NOT NULL
- `templates_favourite_idx` (favourite, id)
- `templates_folder_idx` (folder_id) WHERE folder_id IS NOT NULL
- `templates_project_idx` (project_id) WHERE project_id IS NOT NULL
- `templates_updated_idx` (updated_at, id)

```sql
CREATE TABLE templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  listed INTEGER NOT NULL CHECK (listed IN (0, 1)),
  head_version INTEGER NOT NULL CHECK (head_version >= 1),
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, tags TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(tags) AND json_type(tags) = 'array'), folder_id TEXT REFERENCES template_folders(id) ON DELETE SET NULL, favourite INTEGER NOT NULL DEFAULT 0 CHECK (favourite IN (0, 1)), trend_date TEXT
  CHECK (trend_date IS NULL OR trend_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), trend_source TEXT
  CHECK ((trend_source IS NULL) = (trend_date IS NULL)
    AND (trend_source IS NULL OR trend_source IN ('reference', 'hub', 'user'))), provenance TEXT CHECK (provenance IS NULL OR json_valid(provenance)), name_key TEXT NOT NULL DEFAULT '') STRICT
```

## timeline_asset_refs

Assets a timeline's clips use; RESTRICT keeps a used asset from being collected.

| Column        | Type | Null | Default | Key                                  |
| ------------- | ---- | ---- | ------- | ------------------------------------ |
| `timeline_id` | TEXT | no   |         | PK → timelines(id) on delete cascade |
| `asset_id`    | TEXT | no   |         | PK → assets(id) on delete restrict   |

Indexes:

- `timeline_asset_refs_asset_idx` (asset_id)

```sql
CREATE TABLE timeline_asset_refs (
  timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (timeline_id, asset_id)
) STRICT
```

## timeline_comments

| Column        | Type    | Null | Default | Key                               |
| ------------- | ------- | ---- | ------- | --------------------------------- |
| `id`          | TEXT    | no   |         | PK                                |
| `project_id`  | TEXT    | no   |         | → projects(id) on delete cascade  |
| `timeline_id` | TEXT    | no   |         | → timelines(id) on delete cascade |
| `anchor`      | TEXT    | no   |         |                                   |
| `at`          | TEXT    | yes  |         |                                   |
| `body`        | TEXT    | no   |         |                                   |
| `author`      | TEXT    | no   |         |                                   |
| `status`      | TEXT    | no   |         |                                   |
| `reply`       | TEXT    | yes  |         |                                   |
| `change_refs` | TEXT    | yes  |         |                                   |
| `run_id`      | TEXT    | yes  |         |                                   |
| `created_at`  | INTEGER | no   |         |                                   |
| `updated_at`  | INTEGER | no   |         |                                   |

Indexes:

- `timeline_comments_project_idx` (project_id, status)
- `timeline_comments_timeline_idx` (timeline_id, created_at, id)

```sql
CREATE TABLE timeline_comments (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  anchor TEXT NOT NULL CHECK (json_valid(anchor)),
  at TEXT CHECK (at IS NULL OR json_valid(at)),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  author TEXT NOT NULL CHECK (author IN ('user', 'agent')),
  status TEXT NOT NULL CHECK (status IN ('open', 'sent', 'resolved', 'dismissed')),
  reply TEXT CHECK (reply IS NULL OR length(reply) BETWEEN 1 AND 300),
  change_refs TEXT CHECK (change_refs IS NULL OR json_valid(change_refs)),
  run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT
```

## timeline_versions

Saved timeline snapshots (auto, named, before-restore, export), numbered per timeline.

| Column           | Type    | Null | Default | Key                               |
| ---------------- | ------- | ---- | ------- | --------------------------------- |
| `id`             | TEXT    | no   |         | PK                                |
| `timeline_id`    | TEXT    | no   |         | → timelines(id) on delete cascade |
| `number`         | INTEGER | no   |         |                                   |
| `kind`           | TEXT    | no   |         |                                   |
| `label`          | TEXT    | yes  |         |                                   |
| `schema_version` | INTEGER | no   |         |                                   |
| `document`       | TEXT    | no   |         |                                   |
| `revision`       | INTEGER | no   |         |                                   |
| `document_hash`  | TEXT    | no   |         |                                   |
| `command_id`     | TEXT    | yes  |         |                                   |
| `created_at`     | INTEGER | no   |         |                                   |

Indexes:

- `timeline_versions_kind_idx` (timeline_id, kind, number)
- `timeline_versions_number_uq` (unique) (timeline_id, number)

```sql
CREATE TABLE timeline_versions (
  id TEXT PRIMARY KEY NOT NULL,
  timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('auto', 'named', 'before-restore', 'export')),
  label TEXT CHECK (label IS NULL OR length(label) BETWEEN 1 AND 100),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  document TEXT NOT NULL CHECK (json_valid(document)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  document_hash TEXT NOT NULL CHECK (length(document_hash) = 64),
  command_id TEXT,
  created_at INTEGER NOT NULL
) STRICT
```

## timelines

A timeline's working copy (core's Timeline as JSON), its revision and summary columns.

| Column              | Type    | Null | Default | Key                              |
| ------------------- | ------- | ---- | ------- | -------------------------------- |
| `id`                | TEXT    | no   |         | PK                               |
| `project_id`        | TEXT    | no   |         | → projects(id) on delete cascade |
| `name`              | TEXT    | no   |         |                                  |
| `schema_version`    | INTEGER | no   |         |                                  |
| `document`          | TEXT    | no   |         |                                  |
| `revision`          | INTEGER | no   |         |                                  |
| `template_id`       | TEXT    | yes  |         |                                  |
| `template_version`  | INTEGER | yes  |         |                                  |
| `cast_id`           | TEXT    | yes  |         |                                  |
| `variant_index`     | INTEGER | yes  |         |                                  |
| `clip_count`        | INTEGER | no   |         |                                  |
| `duration_value`    | INTEGER | no   |         |                                  |
| `duration_rate_num` | INTEGER | no   |         |                                  |
| `duration_rate_den` | INTEGER | no   |         |                                  |
| `created_at`        | INTEGER | no   |         |                                  |
| `updated_at`        | INTEGER | no   |         |                                  |
| `style_id`          | TEXT    | yes  |         |                                  |

Indexes:

- `timelines_style_idx` (style_id) WHERE style_id IS NOT NULL
- `timelines_template_idx` (template_id) WHERE template_id IS NOT NULL
- `timelines_project_idx` (project_id, updated_at)

```sql
CREATE TABLE timelines (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  document TEXT NOT NULL CHECK (json_valid(document)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  template_id TEXT,
  template_version INTEGER CHECK (template_version IS NULL OR template_version >= 1),
  cast_id TEXT,
  variant_index INTEGER CHECK (variant_index IS NULL OR variant_index BETWEEN 0 AND 9),
  clip_count INTEGER NOT NULL CHECK (clip_count >= 0),
  duration_value INTEGER NOT NULL CHECK (duration_value >= 0),
  duration_rate_num INTEGER NOT NULL CHECK (duration_rate_num > 0),
  duration_rate_den INTEGER NOT NULL CHECK (duration_rate_den > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, style_id TEXT,
  CHECK ((template_id IS NULL) = (template_version IS NULL))
) STRICT
```

## tool_runs

One agent tool call, for tool-run cards and the trace.

| Column            | Type    | Null | Default | Key                                   |
| ----------------- | ------- | ---- | ------- | ------------------------------------- |
| `id`              | TEXT    | no   |         | PK                                    |
| `run_id`          | TEXT    | yes  |         |                                       |
| `conversation_id` | TEXT    | yes  |         | → conversations(id) on delete cascade |
| `message_id`      | TEXT    | yes  |         | → messages(id) on delete set null     |
| `tool_name`       | TEXT    | no   |         |                                       |
| `tool_version`    | TEXT    | no   |         |                                       |
| `status`          | TEXT    | no   |         |                                       |
| `input`           | TEXT    | no   |         |                                       |
| `output`          | TEXT    | yes  |         |                                       |
| `error`           | TEXT    | yes  |         |                                       |
| `command_id`      | TEXT    | yes  |         |                                       |
| `started_at`      | INTEGER | no   |         |                                       |
| `finished_at`     | INTEGER | yes  |         |                                       |
| `side_effect`     | TEXT    | yes  |         |                                       |

Indexes:

- `tool_runs_conversation_idx` (conversation_id, started_at)
- `tool_runs_run_idx` (run_id, started_at)

```sql
CREATE TABLE tool_runs (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  input TEXT NOT NULL CHECK (json_valid(input)),
  output TEXT CHECK (output IS NULL OR json_valid(output)),
  error TEXT CHECK (error IS NULL OR json_valid(error)),
  command_id TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
, side_effect TEXT
  CHECK (side_effect IS NULL OR side_effect IN ('read', 'write', 'destructive', 'external'))) STRICT
```

## trace_runs

Agent runs as the developer trace viewer lists them (P1-G5); the newest 500 are kept.

| Column            | Type    | Null | Default | Key                                    |
| ----------------- | ------- | ---- | ------- | -------------------------------------- |
| `run_id`          | TEXT    | no   |         | PK                                     |
| `conversation_id` | TEXT    | yes  |         | → conversations(id) on delete set null |
| `status`          | TEXT    | no   |         |                                        |
| `message`         | TEXT    | no   |         |                                        |
| `started_at`      | INTEGER | no   |         |                                        |
| `ended_at`        | INTEGER | yes  |         |                                        |
| `gaps`            | TEXT    | no   | '[]'    |                                        |

Indexes:

- `trace_runs_started_idx` (started_at)

```sql
CREATE TABLE trace_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'succeeded', 'failed', 'cancelled')),
  message TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  gaps TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(gaps))
) STRICT
```

## trace_spans

Spans of a traced run; token and cost numbers as columns, other attributes as redacted JSON.

| Column                | Type    | Null | Default | Key                                       |
| --------------------- | ------- | ---- | ------- | ----------------------------------------- |
| `run_id`              | TEXT    | no   |         | PK → trace_runs(run_id) on delete cascade |
| `span_id`             | TEXT    | no   |         | PK                                        |
| `parent_span_id`      | TEXT    | yes  |         |                                           |
| `kind`                | TEXT    | no   |         |                                           |
| `name`                | TEXT    | no   |         |                                           |
| `status`              | TEXT    | no   |         |                                           |
| `started_at`          | INTEGER | no   |         |                                           |
| `ended_at`            | INTEGER | yes  |         |                                           |
| `input_tokens`        | INTEGER | yes  |         |                                           |
| `output_tokens`       | INTEGER | yes  |         |                                           |
| `cached_input_tokens` | INTEGER | yes  |         |                                           |
| `cost_usd`            | REAL    | yes  |         |                                           |
| `cache_hit`           | INTEGER | yes  |         |                                           |
| `attributes`          | TEXT    | no   |         |                                           |

```sql
CREATE TABLE trace_spans (
  run_id TEXT NOT NULL REFERENCES trace_runs(run_id) ON DELETE CASCADE,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('run', 'step', 'model', 'tool', 'approval')),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'cancelled', 'running')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
  cache_hit INTEGER CHECK (cache_hit IS NULL OR cache_hit IN (0, 1)),
  attributes TEXT NOT NULL CHECK (json_valid(attributes)),
  PRIMARY KEY (run_id, span_id)
) STRICT
```

## transcripts

An asset's transcript (core's Transcript, word timings included) and its plain text for search and previews.

| Column       | Type    | Null | Default | Key                               |
| ------------ | ------- | ---- | ------- | --------------------------------- |
| `asset_id`   | TEXT    | no   |         | PK → assets(id) on delete cascade |
| `transcript` | TEXT    | no   |         |                                   |
| `language`   | TEXT    | no   |         |                                   |
| `engine`     | TEXT    | no   |         |                                   |
| `local`      | INTEGER | no   |         |                                   |
| `text`       | TEXT    | no   |         |                                   |
| `generation` | INTEGER | no   |         |                                   |
| `created_at` | INTEGER | no   |         |                                   |

```sql
CREATE TABLE transcripts (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  transcript TEXT NOT NULL CHECK (json_valid(transcript)),
  language TEXT NOT NULL,
  engine TEXT NOT NULL,
  local INTEGER NOT NULL CHECK (local IN (0, 1)),
  text TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  created_at INTEGER NOT NULL
) STRICT
```

## trips

LIB1-PLACE: the library's clips grouped by capture time and place (derived; only `name` is the person's).

| Column        | Type    | Null | Default | Key |
| ------------- | ------- | ---- | ------- | --- |
| `id`          | TEXT    | no   |         | PK  |
| `name`        | TEXT    | yes  |         |     |
| `place`       | TEXT    | yes  |         |     |
| `hint`        | TEXT    | no   | '[]'    |     |
| `month`       | TEXT    | no   |         |     |
| `started_at`  | INTEGER | no   |         |     |
| `ended_at`    | INTEGER | no   |         |     |
| `clips`       | INTEGER | no   |         |     |
| `days`        | INTEGER | no   |         |     |
| `search_text` | TEXT    | no   | ''      |     |
| `created_at`  | INTEGER | no   |         |     |
| `updated_at`  | INTEGER | no   |         |     |

Indexes:

- `trips_started_idx` (started_at)

```sql
CREATE TABLE trips (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 120),
  place TEXT CHECK (place IS NULL OR json_valid(place)),
  hint TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(hint)),
  month TEXT NOT NULL CHECK (length(month) = 7),
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL CHECK (ended_at >= started_at),
  clips INTEGER NOT NULL CHECK (clips > 0),
  days INTEGER NOT NULL CHECK (days > 0),
  search_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT
```

## usb_imports

| Column              | Type    | Null | Default | Key                            |
| ------------------- | ------- | ---- | ------- | ------------------------------ |
| `device_key`        | TEXT    | no   |         | PK                             |
| `item_key`          | TEXT    | no   |         | PK                             |
| `asset_id`          | TEXT    | no   |         | → assets(id) on delete cascade |
| `run_id`            | TEXT    | no   |         |                                |
| `bridge`            | TEXT    | no   |         |                                |
| `device_created_at` | INTEGER | yes  |         |                                |
| `album`             | TEXT    | yes  |         |                                |
| `sha256`            | TEXT    | no   |         |                                |
| `source_sha256`     | TEXT    | yes  |         |                                |
| `imported_at`       | INTEGER | no   |         |                                |

Indexes:

- `usb_imports_asset_idx` (asset_id)

```sql
CREATE TABLE usb_imports (
  device_key TEXT NOT NULL CHECK (length(device_key) BETWEEN 1 AND 128),
  item_key TEXT NOT NULL CHECK (length(item_key) BETWEEN 1 AND 128),
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  bridge TEXT NOT NULL CHECK (bridge IN ('image-capture', 'adb', 'mtp')),
  device_created_at INTEGER,
  album TEXT CHECK (album IS NULL OR length(album) <= 120),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  source_sha256 TEXT CHECK (source_sha256 IS NULL OR length(source_sha256) = 64),
  imported_at INTEGER NOT NULL,
  PRIMARY KEY (device_key, item_key)
) STRICT
```

## vector_indexes

Registry of vector indexes; each owns a `vec_<name>` sqlite-vec table created at runtime.

| Column       | Type    | Null | Default | Key |
| ------------ | ------- | ---- | ------- | --- |
| `name`       | TEXT    | no   |         | PK  |
| `dimensions` | INTEGER | no   |         |     |
| `metric`     | TEXT    | no   |         |     |
| `created_at` | INTEGER | no   |         |     |

```sql
CREATE TABLE vector_indexes (
  name TEXT PRIMARY KEY NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  metric TEXT NOT NULL CHECK (metric IN ('cosine', 'l2')),
  created_at INTEGER NOT NULL
) STRICT
```

## voice_consents

| Column                  | Type    | Null | Default | Key |
| ----------------------- | ------- | ---- | ------- | --- |
| `id`                    | TEXT    | no   |         | PK  |
| `speaker_name`          | TEXT    | no   |         |     |
| `language`              | TEXT    | no   |         |     |
| `terms_version`         | TEXT    | no   |         |     |
| `recording_sha256`      | TEXT    | no   |         |     |
| `recording_duration_ms` | INTEGER | no   |         |     |
| `phrase_match`          | REAL    | no   |         |     |
| `recorded_at`           | INTEGER | no   |         |     |
| `clone`                 | TEXT    | yes  |         |     |
| `updated_at`            | INTEGER | no   |         |     |

Indexes:

- `voice_consents_recorded_idx` (recorded_at, id)

```sql
CREATE TABLE voice_consents (
  id TEXT PRIMARY KEY NOT NULL,
  speaker_name TEXT NOT NULL CHECK (length(speaker_name) BETWEEN 1 AND 80),
  language TEXT NOT NULL,
  terms_version TEXT NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 16),
  recording_sha256 TEXT NOT NULL CHECK (length(recording_sha256) = 64),
  recording_duration_ms INTEGER NOT NULL CHECK (recording_duration_ms BETWEEN 60000 AND 600000),
  phrase_match REAL NOT NULL CHECK (phrase_match BETWEEN 0 AND 1),
  recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0),
  clone TEXT CHECK (clone IS NULL OR json_valid(clone)),
  updated_at INTEGER NOT NULL
) STRICT
```

## workspace_heads

HFW1-WS: the revision each project's workspace is at (0: empty); `workspace.restore` moves it.

| Column       | Type    | Null | Default | Key                                 |
| ------------ | ------- | ---- | ------- | ----------------------------------- |
| `project_id` | TEXT    | no   |         | PK → projects(id) on delete cascade |
| `revision`   | INTEGER | no   |         |                                     |
| `updated_at` | INTEGER | no   |         |                                     |

```sql
CREATE TABLE workspace_heads (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  updated_at INTEGER NOT NULL
) STRICT
```

## workspace_revisions

HFW1-WS: one revision of a project's HyperFrames workspace (core's WorkspaceRevision): its files by path and sha256, never their bytes, which are blobs under `workspaces/<projectId>/blobs/`.

| Column       | Type    | Null | Default | Key                                 |
| ------------ | ------- | ---- | ------- | ----------------------------------- |
| `project_id` | TEXT    | no   |         | PK → projects(id) on delete cascade |
| `revision`   | INTEGER | no   |         | PK                                  |
| `base`       | INTEGER | no   |         |                                     |
| `files`      | TEXT    | no   |         |                                     |
| `file_count` | INTEGER | no   |         |                                     |
| `bytes`      | INTEGER | no   |         |                                     |
| `origin`     | TEXT    | no   |         |                                     |
| `command_id` | TEXT    | yes  |         |                                     |
| `created_at` | INTEGER | no   |         |                                     |

Indexes:

- `workspace_revisions_command_uq` (unique) (command_id)
  WHERE command_id IS NOT NULL

```sql
CREATE TABLE workspace_revisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  base INTEGER NOT NULL CHECK (base >= 0 AND base < revision),
  files TEXT NOT NULL CHECK (json_valid(files) AND json_type(files) = 'array'),
  file_count INTEGER NOT NULL CHECK (file_count BETWEEN 0 AND 512),
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 0 AND 2097152),
  origin TEXT NOT NULL CHECK (origin IN ('ui', 'shortcut', 'agent', 'mcp')),
  command_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, revision)
) STRICT
```
