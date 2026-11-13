// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Phase 2 namespaces the library, Wi-Fi import and template pages read,
 * served by the renderer's fake on the same MessageChannel as the rest:
 * `library` and `indexing` (fake library of 5,000 clips), `transfer` (a
 * scripted phone), `templates` (three templates and two formats) and main's
 * `files.pickFolder`. Each is the owning lane's contract from core, so moving
 * to the real backend changes nothing in the pages.
 */
import {
  appContract,
  implementContract,
  NotFoundError,
  toRpcError,
  type AnyCommand,
  type AppLocale,
  type deviceProcedures,
  type EventBus,
  type Id,
  type RpcRouter,
  type StarterSummary,
} from '@taalcut/core';
import { createFakeLibrary, type FakeLibraryOptions } from './library/fake-library';
import { createFakeTransfer, type FakeTransferOptions } from './fake-transfer';
import type { FakeInstagramAuthRead } from './templates/fake-instagram-saved';
import { createFakeTemplates, type FakeTemplatesOptions } from './templates/fake-templates';
import { fakeProposeEditsFor } from './templates/fake-propose-edits';
import type { FakeStyleProfilesOptions } from './templates/fake-style-profiles';
import { createFakeTemplateLibrary } from './templates/fake-template-library';
import { fakeTemplateSearch, type FakeTemplateSearchScenario } from './templates/fake-template-search';
import { createFakeTemplateMedia, type FakeTemplateMediaOptions } from './templates/template-media';

export interface Phase2FakeOptions {
  readonly library?: FakeLibraryOptions;
  readonly transfer?: FakeTransferOptions;
  readonly templates?: FakeTemplatesOptions;
  /** What files.pickFolder answers; null is the user cancelling the dialog. */
  readonly pickedFolder?: string | null;
  readonly readInstagramAuth?: () => FakeInstagramAuthRead;
  /** LRN1-STY: the templates behind a ready export (the make fakes'), my exports' set; absent, none. */
  readonly readExportedTemplates?: () => readonly Id<'Template'>[];
  /** LRN1-STY: the style profiles' scenario (templates/fake-style-profiles.ts). */
  readonly styleProfiles?: FakeStyleProfilesOptions;
  /** LRN1-TPL: templates.search's scenario (templates/fake-template-search.ts); absent, words only. */
  readonly templateSearch?: FakeTemplateSearchScenario;
  /** REF1: templates.fetchMedia's scenario and pace (templates/template-media.ts); absent, it works. */
  readonly templateMedia?: FakeTemplateMediaOptions;
}

/** The file name the fake's save panel answers with. */
const SAVED_AS = 'Golden hour market.mp4';

const missing = (entity: string, id: string) => toRpcError(NotFoundError({ entity, id }));

/**
 * What Phase 3's fakes add to these namespaces (phase3/fake-phase3.ts): the starters, the USB procedures, stock
 * search and credits (library), and main's file dialog and Save as… for pro exports (files); and a component's
 * licence notice (files.openNotice), from the fake that lists the components (fake-backend.ts).
 */
export interface Phase2Extensions {
  readonly starters: (input: {
    readonly locale: AppLocale;
    readonly forLibrary: boolean;
  }) => StarterSummary[];
  readonly devices: RpcRouter<typeof deviceProcedures, Record<never, never>>;
  readonly library: RpcRouter<
    Pick<typeof appContract.library, 'stockSearch' | 'credits'>,
    Record<never, never>
  >;
  readonly files: RpcRouter<
    Pick<typeof appContract.files, 'pickFile' | 'saveExportAs' | 'openNotice'>,
    Record<never, never>
  >;
}

export function createPhase2Fakes(events: EventBus, options: Phase2FakeOptions = {}) {
  const library = createFakeLibrary(events, options.library);
  const transfer = createFakeTransfer(events, options.transfer);
  const templates = createFakeTemplates(events, options.templates);
  const templateMedia = createFakeTemplateMedia(events, templates, options.templateMedia);
  const templateLibrary = createFakeTemplateLibrary(
    events,
    templates,
    { instagramAuth: options.readInstagramAuth, exportedTemplates: options.readExportedTemplates },
    options.styleProfiles,
  );

  const lib = implementContract(appContract.library);
  const idx = implementContract(appContract.indexing);
  const lan = implementContract(appContract.transfer);
  const tpl = implementContract(appContract.templates);
  const fs = implementContract(appContract.files);

  const router = (extensions: Phase2Extensions) => ({
    library: lib.router({
      browse: lib.browse.handler(({ input }) => library.library.browse(input)),
      search: lib.search.handler(({ input }) => library.library.search(input)),
      findSimilar: lib.findSimilar.handler(({ input }) => library.library.findSimilar(input)),
      asset: lib.asset.handler(async ({ input }) => {
        const detail = await library.library.asset(input.assetId);
        if (!detail) throw missing('asset', input.assetId);
        return detail;
      }),
      transcript: lib.transcript.handler(({ input }) =>
        library.library.transcript(input.assetId, input.fromSegment, input.limit),
      ),
      sources: lib.sources.handler(() => library.library.sources()),
      storage: lib.storage.handler(() => library.library.storage()),
      trips: lib.trips.handler(() => ({ trips: library.places.trips() })),
      places: lib.places.handler(() => ({ places: library.places.places() })),
      actions: lib.actions.handler(() => library.library.actions()),
      ...extensions.library,
    }),
    indexing: idx.router({
      status: idx.status.handler(() => library.indexing.status()),
      prioritise: idx.prioritise.handler(({ input }) => library.indexing.prioritise(input.assetIds)),
      pause: idx.pause.handler(() => library.indexing.pause()),
      resume: idx.resume.handler(() => library.indexing.resume()),
      retryFailed: idx.retryFailed.handler(() => library.indexing.retryFailed()),
    }),
    transfer: lan.router({
      open: lan.open.handler(({ signal }) => transfer.open(signal)),
      close: lan.close.handler(({ input }) => transfer.close(input.sessionId)),
      newPairing: lan.newPairing.handler(() => transfer.newPairing()),
      answerApproval: lan.answerApproval.handler(({ input }) =>
        transfer.answerApproval(input.approvalId, input.allow),
      ),
      disconnect: lan.disconnect.handler(({ input }) => transfer.disconnect(input.deviceId)),
      cancelUpload: lan.cancelUpload.handler(({ input }) => transfer.cancelUpload(input.uploadId)),
      interfaces: lan.interfaces.handler(() => transfer.interfaces()),
      forgetDevices: lan.forgetDevices.handler(() => ({ forgotten: 1 })),
      // USB import (P3-B4, P3-B5): faked in the devices lane's shapes (phase3/fake-devices.ts).
      ...extensions.devices,
    }),
    templates: tpl.router({
      list: tpl.list.handler(({ input }) => templates.list(input)),
      search: tpl.search.handler(({ input }) =>
        fakeTemplateSearch(templates, input, options.templateSearch ?? null),
      ),
      get: tpl.get.handler(async ({ input }) => {
        const found = await templates.get(input.templateId, input.version);
        if (!found) throw missing('template', input.templateId);
        return found;
      }),
      versions: tpl.versions.handler(({ input }) => {
        const versions = templates.versions(input.templateId);
        if (!versions) throw missing('template', input.templateId);
        return versions;
      }),
      formats: tpl.formats.handler(() => templates.formats()),
      starters: tpl.starters.handler(({ input }) => extensions.starters(input)),
      // REF1: an older template fetches its reel again and keeps it.
      fetchMedia: tpl.fetchMedia.handler(({ input }) => templateMedia.fetchMedia(input.id)),
      // BRK1-REV: "Tell Taalcut", scripted (templates/fake-propose-edits.ts).
      proposeEdits: tpl.proposeEdits.handler(({ input }) => fakeProposeEditsFor(templates, input)),
      ...templateLibrary.router,
    }),
    files: fs.router({
      pickCreationDirectory: fs.pickCreationDirectory.handler(() =>
        // eslint-disable-next-line lingui/no-unlocalized-strings -- native picker fixture label
        options.pickedFolder === null ? null : { accessId: 'fake-creation-grant', label: 'Product project' },
      ),
      pickFolder: fs.pickFolder.handler(() => {
        const path =
          options.pickedFolder === undefined ? '/Users/me/Movies/Weekend in Lisbon' : options.pickedFolder;
        return path === null ? null : { path };
      }),
      revealRender: fs.revealRender.handler(() => undefined),
      // UX2: Finder for a clip's original. Like main, not found when no copy of it is present on this Mac.
      revealAsset: fs.revealAsset.handler(async ({ input }) => {
        const detail = await library.library.asset(input.assetId);
        if (!detail?.locations.some((location) => location.state === 'present'))
          throw missing('asset', input.assetId);
      }),
      // The save panel's answer: the name the fake's person types (a file name: data, not UI copy).
      saveRenderAs: fs.saveRenderAs.handler(() => ({ saved: true, fileName: SAVED_AS })),
      openSystemSettings: fs.openSystemSettings.handler(() => undefined),
      // The contract's schema already refused any page off EXTERNAL_LINK_HOSTS; there is no browser to open.
      openExternal: fs.openExternal.handler(() => undefined),
      ...extensions.files,
      ...templateLibrary.files,
    }),
  });

  const commands: AnyCommand[] = [...library.commands, ...templates.commands, ...templateLibrary.commands];
  return { router, commands, library, transfer, templates, templateLibrary };
}

export type Phase2Fakes = ReturnType<typeof createPhase2Fakes>;
