// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* import: this feature's look and its showcase's words (WEB3; the import lane owns this file).
 * Server-safe data: no 'use client', so the page's server code can read it. Teal is the job: the footage is yours.
 * Kaatu films with a phone held up (its pose), the footage it brings in. */

import { Camera, FolderSync, HardDriveDownload, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FeatureLook } from '../look-types';

export const LOOK: FeatureLook = {
  icon: HardDriveDownload,
  job: 'you',
  area: 'library',
  pose: 'film',
  stickers: [
    { field: 'teal', icon: Wifi },
    { field: 'lime', icon: FolderSync },
    { field: 'sky', icon: Camera },
  ],
};

/** The showcase's heading, and its one line on how to use what is in the window. */
export const HINT: { readonly title: string; readonly hint: ReactNode } = {
  title: 'Footage, brought in',
  hint: 'Choose a way in, or switch the window between Mac and Ubuntu. On the phone, choose from Files or Photos to send more clips.',
};
