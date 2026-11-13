// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Adds the optional TemplatesService reads (folders, starters, exportDocument) without editing
 * `createTemplateService`. Desktop wiring calls this wrapper.
 */
import type {
  AppLocale,
  AsyncResult,
  InstagramCollection,
  InstagramReelsPage,
  InstagramReelsQuery,
  InstagramSavedStatus,
  StarterSummary,
  TemplateDocumentInput,
  TemplateFolder,
  TemplateFolderStore,
  TemplatesService,
} from '@taalcut/core';
import type { InstagramSavedService } from '../instagram/instagram-service';
import { exportTemplateDocument, type TemplateFileDeps } from './template-file';

export interface LibraryReadDeps {
  readonly folders: TemplateFolderStore;
  readonly starters: {
    starters(input: {
      readonly locale: AppLocale;
      readonly forLibrary: boolean;
    }): AsyncResult<StarterSummary[]>;
  };
  readonly files: TemplateFileDeps;
  readonly instagram?: InstagramSavedService;
}

/** Each read is attached only when its store exists. The contract treats a missing method as not implemented. */
export function withLibraryReads<S extends TemplatesService>(
  service: S,
  deps: LibraryReadDeps,
): S & Required<Pick<TemplatesService, 'folders' | 'starters' | 'exportDocument'>>;
export function withLibraryReads<S extends TemplatesService>(
  service: S,
  deps: Partial<LibraryReadDeps>,
): S &
  Partial<
    Pick<
      TemplatesService,
      'folders' | 'starters' | 'exportDocument' | 'instagramStatus' | 'instagramCollections' | 'instagramReels'
    >
  >;
export function withLibraryReads<S extends TemplatesService>(
  service: S,
  deps: Partial<LibraryReadDeps>,
): S &
  Partial<
    Pick<
      TemplatesService,
      'folders' | 'starters' | 'exportDocument' | 'instagramStatus' | 'instagramCollections' | 'instagramReels'
    >
  > {
  const folders = deps.folders;
  const starters = deps.starters;
  const files = deps.files;
  const instagram = deps.instagram;
  return {
    ...service,
    ...(folders ? { folders: (): AsyncResult<TemplateFolder[]> => folders.list() } : {}),
    ...(starters
      ? { starters: (input: { locale: AppLocale; forLibrary: boolean }) => starters.starters(input) }
      : {}),
    ...(files
      ? { exportDocument: (input: TemplateDocumentInput) => exportTemplateDocument(files, input) }
      : {}),
    ...(instagram
      ? {
          instagramStatus: (): AsyncResult<InstagramSavedStatus> => instagram.status(),
          instagramCollections: (): AsyncResult<InstagramCollection[]> => instagram.collections(),
          instagramReels: (query: InstagramReelsQuery): AsyncResult<InstagramReelsPage> =>
            instagram.reels(query),
        }
      : {}),
  };
}
