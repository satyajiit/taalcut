// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's file dialog (files.pickFile) as the fake answers it, per purpose: a reference, a track, a brand image
 * (P3-V10) or a template file (P3-V14). Null is the person cancelling. fake-phase2.ts spreads `router` into
 * `files`.
 */
import { appContract, implementContract, type FILE_PICK_PURPOSES } from '@taalcut/core';

const PROCEDURES = { pickFile: appContract.files.pickFile };
type FilePickPurpose = (typeof FILE_PICK_PURPOSES)[number];

export interface FakeFilePicksOptions {
  /** What the dialog answers for each purpose; absent or null: cancelled. */
  readonly picks?: Partial<Record<FilePickPurpose, string | null>>;
}

export function createFakeFilePicks(options: FakeFilePicksOptions = {}) {
  const picks = new Map<FilePickPurpose, string | null>(
    Object.entries(options.picks ?? {}) as [FilePickPurpose, string | null][],
  );
  const os = implementContract(PROCEDURES);
  const router = {
    pickFile: os.pickFile.handler(({ input }) => {
      const path = picks.get(input.purpose) ?? null;
      return path === null ? null : { path };
    }),
  };
  return {
    router,
    /** What the next dialogs for this purpose answer (tests). */
    setPick: (purpose: FilePickPurpose, path: string | null) => void picks.set(purpose, path),
  };
}

export type FakeFilePicks = ReturnType<typeof createFakeFilePicks>;
