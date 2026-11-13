// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 2 namespaces main serves itself (P2-X4, P2-X5, P2-X6): app updates, crash
 * reports, feedback with a debug bundle, and the system's file dialogs and
 * Finder. Each needs Electron, so only main can serve it.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { eventIterator, ipc } from './contract';
import { debugCollectOptionsSchema, debugSectionSchema } from './debug-bundle-contract';
import { externalLinkSchema } from './external-links';

export const UPDATE_CHANNELS = ['internal', 'alpha', 'beta', 'stable'] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];
/** P3-B9: the channels a person can choose on a public build. Team builds (internal, alpha) can't. */
export const PUBLIC_UPDATE_CHANNELS = ['stable', 'beta'] as const;
export type PublicUpdateChannel = (typeof PUBLIC_UPDATE_CHANNELS)[number];

export const updateStateSchema = z.object({
  version: z.string().min(1),
  /** null: no feed (unpackaged, or a build without one). */
  channel: z.enum(UPDATE_CHANNELS).nullable(),
  /** P3-B9: the person's choice on a public build; null on team builds and builds without a feed. */
  choice: z.enum(PUBLIC_UPDATE_CHANNELS).nullable().default(null),
  status: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('off') }),
    z.object({ kind: z.literal('idle'), checkedAt: z.int().nonnegative().optional() }),
    z.object({ kind: z.literal('checking') }),
    z.object({
      kind: z.literal('downloading'),
      version: z.string(),
      percent: z.number().min(0).max(100),
      /** A delta (blockmap) download rather than the full zip. */
      delta: z.boolean().optional(),
    }),
    /** Verified and staged: installs on quit, or now with installNow. */
    z.object({
      kind: z.literal('ready'),
      version: z.string(),
      /** Plain text in the app's language (else English): `- ` bullets and `**bold**` only. */
      notes: z.string().max(8000).optional(),
      releaseDate: z.int().nonnegative().optional(),
    }),
    z.object({ kind: z.literal('error'), error: publicErrorSchema }),
  ]),
  /** The last automatic rollback on this Mac, for About's notice; null when none. */
  lastRollback: z
    .object({ from: z.string(), to: z.string(), at: z.int().nonnegative() })
    .nullable()
    .default(null),
});
export type UpdateState = z.output<typeof updateStateSchema>;

/** appContract.updates, owner main (Settings → About). */
export const updatesContract = {
  state: ipc.output(updateStateSchema),
  /** The current state first, then every change. */
  changed: ipc.output(eventIterator(updateStateSchema)),
  check: ipc.output(updateStateSchema),
  /** Quits and installs a staged update; desktop.update_not_ready otherwise. */
  installNow: ipc.output(z.void()),
};

/** appContract.crashes, owner main: a window's uncaught errors. Dropped unless crash reporting is on. */
export const crashesContract = {
  report: ipc
    .input(
      z.object({
        kind: z.enum(['error', 'unhandledrejection']),
        message: z.string().max(2000),
        stack: z.string().max(16_000).optional(),
      }),
    )
    .output(z.void()),
};

/** appContract.feedback, owner main (Help → Send feedback). */
export const feedbackContract = {
  /** What a bundle with these options would hold. Nothing is written. */
  preview: ipc.input(debugCollectOptionsSchema).output(
    z.object({
      sections: z.array(debugSectionSchema.omit({ text: true }).extend({ bytes: z.int().nonnegative() })),
      totalBytes: z.int().nonnegative(),
    }),
  ),
  /** Builds, scans and sends. core.local_only, desktop.feedback_unavailable, desktop.debug_bundle_unsafe. */
  send: ipc
    .input(z.object({ message: z.string().min(1).max(5000), bundle: debugCollectOptionsSchema.nullable() }))
    .output(z.object({ id: z.string().min(1) })),
  /** Builds and scans, then asks where to save it. */
  saveBundle: ipc
    .input(debugCollectOptionsSchema)
    .output(z.object({ saved: z.boolean(), fileName: z.string().optional() })),
};

/** P3: a brand kit's logo (styles.importImage) and a template file (template.import). */
export const FILE_PICK_PURPOSES = ['reference', 'music', 'brandImage', 'templateFile'] as const;

/** The System Settings panes Taalcut sends people to. Main opens only these fixed URLs. */
export const SYSTEM_SETTINGS_PANES = ['filesAndFolders', 'storage'] as const;
export type SystemSettingsPane = (typeof SYSTEM_SETTINGS_PANES)[number];
export const SYSTEM_SETTINGS_URLS: Readonly<Record<SystemSettingsPane, string>> = {
  /** Privacy & Security › Files and Folders: the fix when macOS won't let Taalcut read a folder source. */
  filesAndFolders: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
  /** General › Storage: the fix when the models this Mac needs don't fit on its disk (UX2-DOWNLOADER). */
  storage: 'x-apple.systempreferences:com.apple.settings.Storage',
};

/** appContract.files, owner main: the system's dialogs as a sheet on the caller's window, and Finder. */
export const filesContract = {
  pickCreationDirectory: ipc.output(
    z.object({ accessId: z.string().min(1).max(200), label: z.string().min(1).max(200) }).nullable(),
  ),
  /** A folder (a library source); null when cancelled. Then `library.addSource` or `library.setOriginalsRoot`. */
  pickFolder: ipc.output(z.object({ path: z.string() }).nullable()),
  pickFile: ipc
    .input(z.object({ purpose: z.enum(FILE_PICK_PURPOSES) }))
    .output(z.object({ path: z.string() }).nullable()),
  revealRender: ipc.input(z.object({ renderId: idSchema<'Render'>() })).output(z.void()),
  /**
   * Shows a clip's original in Finder (UX2): its first present location, managed copies first. core.not_found when
   * no location is present (the drive is away, the file is gone, or it is only in iCloud).
   */
  revealAsset: ipc.input(z.object({ assetId: idSchema<'Asset'>() })).output(z.void()),
  /**
   * "Save as…" for a finished render: main's save dialog as a sheet on the caller's window, then a copy of
   * the file (and its subtitle sidecars beside the chosen name). The window names the render, never a path.
   * `saved: false` when cancelled; core.not_found for a render without a delivered file.
   */
  saveRenderAs: ipc
    .input(z.object({ renderId: idSchema<'Render'>() }))
    .output(z.object({ saved: z.boolean(), fileName: z.string().optional() })),
  /**
   * Opens a pane of System Settings (SYSTEM_SETTINGS_URLS): the `system.openFilesAndFolders` and `system.openStorage`
   * UI commands' action.
   */
  openSystemSettings: ipc.input(z.object({ pane: z.enum(SYSTEM_SETTINGS_PANES) })).output(z.void()),
  /**
   * UX2-DOWNLOADER round 3: opens an installed component's licence notice (the verified NOTICE.txt saved in its
   * folder) in the Mac's text viewer. The window names the component, never a path; core.not_found when it isn't
   * installed or its notice is gone.
   */
  openNotice: ipc.input(z.object({ componentId: z.string().min(1).max(100) })).output(z.void()),
  /**
   * Round P3-3 (G8): opens a web page in the default browser: "Add credit", "Manage usage", a provider's key
   * page, the beta terms. Only https pages on EXTERNAL_LINK_HOSTS (external-links.ts); any other is
   * core.validation before main acts. The window's own links and `CardActions.openExternal` go through here.
   */
  openExternal: ipc.input(z.object({ url: externalLinkSchema })).output(z.void()),
  /** P3-V5: Save as… for a pro export the agent process wrote; the window names the file, never a path. */
  saveExportAs: ipc
    .input(
      z.object({
        fileName: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[^/\\:]+$/),
      }),
    )
    .output(z.object({ saved: z.boolean(), fileName: z.string().optional() })),
  /** P3-V14: Save as… for a template file; main gets the text from the agent's templates.exportDocument. */
  saveTemplateAs: ipc
    .input(
      z.object({
        templateId: idSchema<'Template'>(),
        version: z.int().min(1).optional(),
        includeStyle: z.boolean().default(false),
      }),
    )
    .output(z.object({ saved: z.boolean(), fileName: z.string().optional() })),
};
