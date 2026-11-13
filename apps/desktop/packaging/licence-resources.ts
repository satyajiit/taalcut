// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { chmodSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AfterPackContext, FileSet } from 'electron-builder';

/** ShipIt removes quarantine from each resource; a copied read-only vendor licence prevents installation. */
export function prepareLicenceResources(context: AfterPackContext): void {
  if (context.electronPlatformName !== 'darwin') return;
  const app = `${context.packager.appInfo.productFilename}.app`;
  const licences = join(context.appOutDir, app, 'Contents', 'Resources', 'licences');
  for (const name of readdirSync(licences)) {
    const file = join(licences, name);
    const stat = lstatSync(file);
    if (!stat.isFile()) throw new Error(`packaged licence is not a regular file: ${name}`);
    // Change only the packaged copy, before the outer app is signed. Keep content and executable bits intact.
    if (!(stat.mode & 0o200)) chmodSync(file, (stat.mode & 0o777) | 0o200);
  }
}

/** Ship the original-code grant and vendor terms beside the executable, outside the source repository. */
export function licenceResources(projectDir: string): FileSet[] {
  const root = join(projectDir, '..', '..');
  return [
    ...['LICENSE', 'LICENSE-EXCEPTIONS.md', 'MEDIA-LICENSE.md', 'NOTICE'].map((name) => ({
      from: join(root, name),
      to: join('licences', name),
    })),
    { from: join(root, 'third_party/react-bits/LICENSE'), to: 'licences/react-bits-LICENSE' },
    ...(
      [
        ['third_party/page-mascot/LICENSE', 'page-mascot-LICENSE'],
        ['third_party/earshot/LICENSE', 'earshot-LICENSE'],
        ['third_party/earshot/NOTICE', 'earshot-NOTICE'],
        ['third_party/signalsmith-stretch/LICENSE.txt', 'signalsmith-stretch-LICENSE.txt'],
        ['third_party/signalsmith-stretch/LICENSE-signalsmith-linear.txt', 'signalsmith-linear-LICENSE.txt'],
        ['native/mac-helper/LICENSES/FluidAudio-Apache-2.0.txt', 'FluidAudio-Apache-2.0.txt'],
        [
          'apps/desktop/packaging/licences/FluidAudio-fastcluster-LICENSE.txt',
          'FluidAudio-fastcluster-LICENSE.txt',
        ],
        ['apps/desktop/packaging/licences/GSAP-standard-license.txt', 'GSAP-standard-license.txt'],
        ['apps/desktop/packaging/licences/GSAP-provenance.json', 'GSAP-provenance.json'],
      ] as const
    ).map(([from, to]) => ({ from: join(root, from), to: join('licences', to) })),
    { from: join(root, 'tools/ffmpeg/source-distribution.json'), to: 'bin/source-distribution.json' },
  ];
}
