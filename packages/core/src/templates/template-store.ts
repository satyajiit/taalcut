// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template lineages, their immutable versions and assets (contact sheets).
 * Implemented by @taalcut/library, registered by TemplateStoreToken. Writes
 * with a CommandContext are staged in the command's unit of work (section 10,
 * "Staged writes"). Reads return the stored JSON so @taalcut/templates can
 * migrate it before validating. REF1: each template's kept reel is in the
 * library's TemplateMediaStore (TemplateMediaStoreToken).
 */
import type { ProjectId, TemplateFolderId, TemplateId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { CommandContext, CommandSource } from '../commands/definition';
import { createToken } from '../di/token';
import type { TemplateProvenance, TrendFreshness } from './template-library';
import type { TemplateMedia, TemplateMediaSource } from './template-parts';
import type { Template } from './template-schema';
import type {
  TemplateListPage,
  TemplateListQuery,
  TemplateSummary,
  TemplateVersionSummary,
} from './templates-contract';

export interface TemplateMeta {
  readonly name: string;
  readonly projectId: ProjectId | null;
  readonly listed: boolean;
  /** P3: where it came from (a hub fork, a file, a starter); absent or null for the person's own. */
  readonly provenance?: TemplateProvenance | null;
  /** P3: absent or null; a reference template's create defaults it to its analysis date. */
  readonly trendFreshness?: TrendFreshness | null;
}

/** What `setMeta` may change: the Phase 2 fields and P3's library metadata. */
export interface TemplateMetaPatch {
  readonly name?: string;
  readonly listed?: boolean;
  readonly archived?: boolean;
  readonly tags?: readonly string[];
  readonly folderId?: TemplateFolderId | null;
  readonly favourite?: boolean;
  readonly trendFreshness?: TrendFreshness | null;
  readonly provenance?: TemplateProvenance | null;
}

export interface TemplateChange {
  readonly command: string;
  readonly source: CommandSource;
  /** sha256 of the canonical command name and payload: finds the version again on redo. */
  readonly changeKey: string;
}

export interface StoredTemplateVersion {
  readonly summary: TemplateSummary;
  readonly version: number;
  readonly schemaVersion: number;
  /** As stored; @taalcut/templates migrates and validates it. */
  readonly json: unknown;
}

export interface TemplateStore {
  /** The lineage and version 1 (head 1), in one write. */
  create(template: Template, meta: TemplateMeta, context?: CommandContext): AsyncResult<TemplateSummary>;
  /** A new version (a new number, its parent existing) that becomes the head. core.conflict if the number is taken. */
  addVersion(
    template: Template,
    change: TemplateChange,
    context?: CommandContext,
  ): AsyncResult<TemplateSummary>;
  /** core.conflict unless the head is `expectedHead`. */
  setHead(
    input: { readonly templateId: TemplateId; readonly version: number; readonly expectedHead: number },
    context?: CommandContext,
  ): AsyncResult<TemplateSummary>;
  setMeta(
    templateId: TemplateId,
    patch: TemplateMetaPatch,
    context?: CommandContext,
  ): AsyncResult<TemplateSummary>;
  /** The lineage, every version and assets no other template uses. */
  remove(templateId: TemplateId, context?: CommandContext): AsyncResult<void>;
  /** Default: the head. */
  get(templateId: TemplateId, version?: number): AsyncResult<StoredTemplateVersion>;
  findChild(templateId: TemplateId, parentVersion: number, changeKey: string): AsyncResult<number | null>;
  latestVersion(templateId: TemplateId): AsyncResult<number>;
  versions(templateId: TemplateId): AsyncResult<TemplateVersionSummary[]>;
  /** Full-text search over name, slot intents and overlay text. */
  list(query: TemplateListQuery): AsyncResult<TemplateListPage>;
  /** Timelines, in any project, that use any version. */
  usedBy(templateId: TemplateId): AsyncResult<number>;
  putAsset(
    bytes: Uint8Array,
    mediaType: 'image/jpeg' | 'image/webp',
  ): AsyncResult<{ readonly sha256: string; readonly bytes: number }>;
  /** The asset's file, for main's app://media/templates/<sha256> route. */
  assetPath(sha256: string): AsyncResult<string>;
}

export const TemplateStoreToken = createToken<TemplateStore>('core.templateStore');

/** REF1: the file a template keeps as its media, and what was measured of it. */
export interface KeepTemplateMediaInput {
  /** Absolute: a download in the experiment's scratch folder, or the person's own file. */
  readonly path: string;
  /** 'move' a download out of scratch; 'copy' a person's file, which stays where it is, untouched. */
  readonly mode: 'move' | 'copy';
  readonly durationMs: number;
  readonly hasAudio: boolean;
  readonly source: TemplateMediaSource;
}

/**
 * REF1: each template's kept reel, video and music (templateMediaSchema), in `<app data>/templates/media/<template
 * id>/`. Implemented by @taalcut/library (migration 37); a template's summary carries its row. Deleting a template
 * deletes its media.
 */
export interface TemplateMediaStore {
  /**
   * Keeps the file as the template's media, replacing any it had; measures its size and sha256. core.not_found
   * when the template is gone or the file is missing.
   */
  keep(templateId: TemplateId, input: KeepTemplateMediaInput): AsyncResult<TemplateMedia>;
  /** The kept media and its file's absolute path; null when the template has none or the file is gone. */
  get(templateId: TemplateId): AsyncResult<{ readonly media: TemplateMedia; readonly path: string } | null>;
  /** Removes the template's media, row and folder; a template without media is not an error. */
  remove(templateId: TemplateId): AsyncResult<void>;
}

export const TemplateMediaStoreToken = createToken<TemplateMediaStore>('core.templateMediaStore');
